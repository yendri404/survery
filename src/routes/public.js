import { HttpError, readForm, redirect, sendHtml } from '../http.js';
import { clientIp, createRateLimiter } from '../rate-limit.js';
import { parseRespondentName, validateAnswers } from '../surveys.js';

/** Respondent-facing routes: no account required. */
export function registerPublicRoutes({ route, repo, config, views }) {
  const submissions = createRateLimiter({ limit: config.submissionLimit, windowMs: config.submissionWindowMs });

  function surveyByToken(ctx) {
    const survey = repo.getSurveyByToken(ctx.params.token);
    if (!survey) {
      const err = new HttpError(404, 'This survey does not exist. Check the link you received.');
      err.respondent = true;
      throw err;
    }
    return survey;
  }

  route('GET', '/s/:token', (ctx) => {
    const survey = surveyByToken(ctx);
    if (!survey.isOpen) return sendHtml(ctx.res, 200, views.closedPage({ survey }));
    sendHtml(ctx.res, 200, views.publicFormPage({ survey }));
  });

  route('POST', '/s/:token', async (ctx) => {
    const survey = surveyByToken(ctx);
    const form = await readForm(ctx.req);
    if (!survey.isOpen) return sendHtml(ctx.res, 403, views.closedPage({ survey }));

    const limitKey = `${survey.id}|${clientIp(ctx.req, config.trustProxy)}`;
    if (submissions.isLimited(limitKey)) {
      const retryAfter = submissions.retryAfterSeconds(limitKey);
      ctx.res.setHeader('Retry-After', String(retryAfter));
      const err = new HttpError(429, `Too many responses from this device. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`);
      err.respondent = true;
      throw err;
    }

    const { answers, errors } = validateAnswers(survey.fields, form);
    const respondent = parseRespondentName(form.get('respondent_name'));
    if (Object.keys(errors).length || respondent.error) {
      return sendHtml(ctx.res, 422, views.publicFormPage({
        survey, values: answers, errors, respondentName: respondent.name, respondentNameError: respondent.error,
      }));
    }
    submissions.hit(limitKey);
    repo.addResponse(survey.id, answers, respondent.name);
    redirect(ctx.res, `/s/${encodeURIComponent(survey.publicToken)}/thanks`);
  });

  route('GET', '/s/:token/thanks', (ctx) => {
    sendHtml(ctx.res, 200, views.thanksPage({ survey: surveyByToken(ctx) }));
  });
}
