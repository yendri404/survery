import { hashToken, newToken } from '../auth.js';
import { HttpError, parseCookies, readForm, redirect, safeNext, sendHtml } from '../http.js';
import { LANGUAGE_COOKIE, SUPPORTED_LANGUAGES } from '../i18n.js';
import { clientIp, createRateLimiter } from '../rate-limit.js';
import { parseRespondentName, surveyStatus, validateAnswers } from '../surveys.js';

const DEVICE_COOKIE = 'sharevy_device';
const DEVICE_ID = /^[A-Za-z0-9_-]{20,100}$/;
const DEVICE_MAX_AGE = 400 * 24 * 60 * 60; // browsers cap cookie lifetime at 400 days
const LANGUAGE_MAX_AGE = 365 * 24 * 60 * 60;

/** Routes that need no account: the respondent pages and the language switch. */
export function registerPublicRoutes({ route, repo, config, views, today, live, ui }) {
  const submissions = createRateLimiter({ limit: config.submissionLimit, windowMs: config.submissionWindowMs });

  function surveyByToken(ctx) {
    const survey = repo.getSurveyByToken(ctx.params.token);
    if (!survey) {
      const err = new HttpError(404, 'respond.notFound');
      err.respondent = true;
      throw err;
    }
    return survey;
  }

  /**
   * Anonymous device identity: a random id in a long-lived HttpOnly cookie, created on the first
   * submission. Only its hash is stored with the response. Clearing cookies or switching browsers
   * counts as a new device; this limits accidental and casual duplicates, not determined abuse.
   */
  function readDeviceId(ctx) {
    const id = parseCookies(ctx.req.headers.cookie)[DEVICE_COOKIE];
    return id && DEVICE_ID.test(id) ? id : undefined;
  }

  function deviceCookie(id) {
    return `${DEVICE_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_MAX_AGE}${config.cookieSecure ? '; Secure' : ''}`;
  }

  /**
   * Language switch: /lang/<code>?next=<path> remembers the choice in a cookie and returns to the
   * page the visitor was on. A plain link, so it works without JavaScript.
   */
  route('GET', '/lang/:code', (ctx) => {
    const { code } = ctx.params;
    if (!SUPPORTED_LANGUAGES.includes(code)) throw new HttpError(404, 'error.pageNotFound');
    const cookie = `${LANGUAGE_COOKIE}=${code}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${LANGUAGE_MAX_AGE}${config.cookieSecure ? '; Secure' : ''}`;
    redirect(ctx.res, safeNext(ctx.url.searchParams.get('next'), '/'), { 'Set-Cookie': cookie });
  });

  const alreadyAnswered = (survey, deviceId) => Boolean(deviceId) && repo.hasDeviceResponse(survey.id, hashToken(deviceId));

  route('GET', '/s/:token', (ctx) => {
    const survey = surveyByToken(ctx);
    const status = surveyStatus(survey, today());
    if (status !== 'open') return sendHtml(ctx.res, 200, views.closedPage({ ...ui(ctx), survey, status }));
    if (alreadyAnswered(survey, readDeviceId(ctx))) return sendHtml(ctx.res, 200, views.alreadyAnsweredPage({ ...ui(ctx), survey }));
    sendHtml(ctx.res, 200, views.publicFormPage({ ...ui(ctx), survey }));
  });

  route('POST', '/s/:token', async (ctx) => {
    const survey = surveyByToken(ctx);
    const form = await readForm(ctx.req);
    const status = surveyStatus(survey, today());
    if (status !== 'open') return sendHtml(ctx.res, 403, views.closedPage({ ...ui(ctx), survey, status }));

    const existingDeviceId = readDeviceId(ctx);
    if (alreadyAnswered(survey, existingDeviceId)) return sendHtml(ctx.res, 409, views.alreadyAnsweredPage({ ...ui(ctx), survey }));

    const limitKey = `${survey.id}|${clientIp(ctx.req, config.trustProxy)}`;
    if (submissions.isLimited(limitKey)) {
      const retryAfter = submissions.retryAfterSeconds(limitKey);
      ctx.res.setHeader('Retry-After', String(retryAfter));
      const err = new HttpError(429, 'respond.tooManyResponses', { minutes: Math.ceil(retryAfter / 60) });
      err.respondent = true;
      throw err;
    }

    const { t } = ctx.i18n;
    const { answers, errors } = validateAnswers(survey.fields, form, { t });
    const respondent = parseRespondentName(form.get('respondent_name'), { t });
    if (Object.keys(errors).length || respondent.error) {
      return sendHtml(ctx.res, 422, views.publicFormPage({
        ...ui(ctx), survey, values: answers, errors, respondentName: respondent.name, respondentNameError: respondent.error,
      }));
    }

    const deviceId = existingDeviceId ?? newToken();
    // The unique index decides when two submissions from one device race each other.
    const responseId = repo.addResponse(survey.id, answers, respondent.name, hashToken(deviceId));
    if (responseId === null) return sendHtml(ctx.res, 409, views.alreadyAnsweredPage({ ...ui(ctx), survey }));

    submissions.hit(limitKey);
    live.surveyChanged(survey);
    const headers = existingDeviceId ? {} : { 'Set-Cookie': deviceCookie(deviceId) };
    redirect(ctx.res, `/s/${encodeURIComponent(survey.publicToken)}/thanks`, headers);
  });

  route('GET', '/s/:token/thanks', (ctx) => {
    sendHtml(ctx.res, 200, views.thanksPage({ ...ui(ctx), survey: surveyByToken(ctx) }));
  });
}
