import { hashToken, newToken } from '../auth.js';
import { ApiError, coded, validationFailed } from '../errors.js';
import { readJson, sendJson } from '../http.js';
import { clientIp, createRateLimiter } from '../rate-limit.js';
import { parseRespondentName, surveyStatus, validateAnswers } from '../surveys.js';

/** Format of the X-Device-Id header: a random id the client generates once and keeps. */
export const DEVICE_ID = /^[A-Za-z0-9_-]{20,100}$/;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * JSON answers ({ fieldId: "text" | ["a", "b"] }) as the name/value pairs validateAnswers reads
 * (`f_<fieldId>`, repeated for lists). Nested objects and nulls are dropped, like a missing answer.
 */
function answersForm(answers) {
  const form = new URLSearchParams();
  for (const [id, value] of Object.entries(answers)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v !== null && v !== undefined && typeof v !== 'object') form.append(`f_${id}`, String(v));
    }
  }
  return form;
}

/** Respondent endpoints: no account; a survey is reached through its public token. */
export function registerPublicRoutes({ route, repo, config, today, live }) {
  const submissions = createRateLimiter({ limit: config.submissionLimit, windowMs: config.submissionWindowMs });

  function surveyByToken(ctx) {
    const survey = repo.getSurveyByToken(ctx.params.token);
    if (!survey) throw new ApiError(404, 'respond.notFound');
    return survey;
  }

  /**
   * Anonymous device identity: the X-Device-Id header, generated and kept by the client.
   * Only its hash is stored with the response. A new id counts as a new device; this limits
   * accidental and casual duplicates, not determined abuse.
   */
  function readDeviceId(ctx) {
    const id = ctx.req.headers['x-device-id'];
    if (id === undefined) return undefined;
    if (!DEVICE_ID.test(id)) throw new ApiError(400, 'error.invalidDeviceId');
    return id;
  }

  const alreadyAnswered = (survey, deviceId) => Boolean(deviceId) && repo.hasDeviceResponse(survey.id, hashToken(deviceId));

  function closedError(survey, status) {
    return status === 'expired'
      ? new ApiError(403, 'respond.closedOn', { date: survey.closesOn })
      : new ApiError(403, 'respond.closed');
  }

  route('GET', '/public/surveys/:token', (ctx) => {
    const survey = surveyByToken(ctx);
    const deviceId = readDeviceId(ctx);
    sendJson(ctx.res, 200, {
      survey: {
        title: survey.title,
        description: survey.description,
        closesOn: survey.closesOn,
        status: surveyStatus(survey, today()),
        fields: survey.fields,
        alreadyAnswered: alreadyAnswered(survey, deviceId),
      },
    });
  });

  /** Body: { respondentName?: string, answers: { [fieldId]: string | string[] } }. */
  route('POST', '/public/surveys/:token/responses', async (ctx) => {
    const survey = surveyByToken(ctx);
    const existingDeviceId = readDeviceId(ctx);
    const body = await readJson(ctx.req);
    const status = surveyStatus(survey, today());
    if (status !== 'open') throw closedError(survey, status);
    if (alreadyAnswered(survey, existingDeviceId)) throw new ApiError(409, 'respond.alreadyAnswered');

    const limitKey = `${survey.id}|${clientIp(ctx.req, config.trustProxy)}`;
    if (submissions.isLimited(limitKey)) {
      const retryAfter = submissions.retryAfterSeconds(limitKey);
      const err = new ApiError(429, 'respond.tooManyResponses', { minutes: Math.ceil(retryAfter / 60) });
      err.headers = { 'Retry-After': String(retryAfter) };
      throw err;
    }

    const rawAnswers = body.answers ?? {};
    if (!isPlainObject(rawAnswers)) throw validationFailed({ errors: [coded('validation.answersInvalid')] });
    const { answers, errors } = validateAnswers(survey.fields, answersForm(rawAnswers), { t: coded });
    const respondent = parseRespondentName(typeof body.respondentName === 'string' ? body.respondentName : '', { t: coded });
    if (respondent.error) errors.respondentName = respondent.error;
    if (Object.keys(errors).length) throw validationFailed({ fields: errors });

    // Without X-Device-Id the server picks an id and returns it, so the client can keep it.
    const deviceId = existingDeviceId ?? newToken();
    // The unique index decides when two submissions from one device race each other.
    const { error, ...stored } = repo.addResponse(survey.id, answers, respondent.name, hashToken(deviceId)); // { id, number }
    if (error === 'alreadyAnswered') throw new ApiError(409, 'respond.alreadyAnswered');
    if (error === 'surveyMissing') throw new ApiError(404, 'respond.notFound'); // deleted while the body was read

    submissions.hit(limitKey);
    live.surveyChanged(survey);
    sendJson(ctx.res, 201, existingDeviceId ? stored : { ...stored, deviceId });
  });
}
