import { newToken } from '../auth.js';
import { ApiError, coded, validationFailed } from '../errors.js';
import { isoUtc, readJson, sendJson, sendNoContent } from '../http.js';
import { createI18n, isSupportedLanguage, negotiateLanguage } from '../i18n.js';
import { qrPng, qrSvg } from '../qr.js';
import { daysBetween, parseSurveyInput, summarize, surveyStatus, toCsv } from '../surveys.js';

const CSV_DELIMITERS = { comma: ',', semicolon: ';' };
const QR_LABEL = 'QR code that opens this survey';

const percent = (count, answered) => (answered ? Math.round((count / answered) * 100) : 0);

const responseJson = (r) => ({ id: r.id, number: r.number, submittedAt: isoUtc(r.submittedAt), respondentName: r.respondentName, answers: r.answers });

/** Creator endpoints: every one needs a Bearer token and only sees the creator's own surveys. */
export function registerSurveyRoutes({ route, repo, config, today, live }) {
  const authed = (method, path, handler) => route(method, path, handler, { auth: true });

  /** The survey `:id` of the logged-in creator; another creator's survey is "not found", like a missing one. */
  function ownedSurvey(ctx) {
    const id = Number(ctx.params.id);
    const survey = Number.isSafeInteger(id) ? repo.getOwnedSurvey(id, ctx.user.id) : undefined;
    if (!survey) throw new ApiError(404, 'error.surveyNotFound');
    return survey;
  }

  /** Respondents open surveys in the web client, so share links (and QR codes) point there. */
  const shareUrl = (survey) => `${config.webBaseUrl}/s/${survey.publicToken}`;

  function surveyJson(survey, { withFields = true } = {}) {
    return {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      ...(withFields ? { fields: survey.fields } : {}),
      isOpen: survey.isOpen,
      status: surveyStatus(survey, today()),
      closesOn: survey.closesOn,
      responseCount: survey.responseCount ?? 0,
      publicToken: survey.publicToken,
      shareUrl: shareUrl(survey),
      createdAt: isoUtc(survey.createdAt),
      updatedAt: isoUtc(survey.updatedAt),
    };
  }

  const sendSurvey = (ctx, status, id) => sendJson(ctx.res, status, { survey: surveyJson(repo.getOwnedSurvey(id, ctx.user.id)) });

  /** Validates a survey definition body ({ title, description, closesOn, fields }) with the domain rules. */
  async function readDefinition(ctx, currentClosesOn) {
    const body = await readJson(ctx.req);
    const input = {
      title: body.title ?? '',
      description: body.description ?? '',
      fieldsJson: JSON.stringify(body.fields ?? []),
      closesOn: body.closesOn ?? '',
    };
    const { value, errors } = parseSurveyInput(input, { today: today(), currentClosesOn, t: coded });
    if (errors.length) throw validationFailed({ errors });
    return value;
  }

  authed('GET', '/surveys', (ctx) => {
    sendJson(ctx.res, 200, { surveys: repo.listSurveys(ctx.user.id).map((s) => surveyJson(s, { withFields: false })) });
  });

  // Registered before /surveys/:id so "events" is never read as an id.
  authed('GET', '/surveys/events', (ctx) => live.stream(ctx.req, ctx.res, `owner:${ctx.user.id}`));

  authed('POST', '/surveys', async (ctx) => {
    const value = await readDefinition(ctx);
    const id = repo.createSurvey({ ownerId: ctx.user.id, publicToken: newToken(18), ...value });
    live.surveyChanged({ id, ownerId: ctx.user.id });
    sendSurvey(ctx, 201, id);
  });

  authed('GET', '/surveys/:id', (ctx) => sendJson(ctx.res, 200, { survey: surveyJson(ownedSurvey(ctx)) }));

  authed('PUT', '/surveys/:id', async (ctx) => {
    const survey = ownedSurvey(ctx);
    const value = await readDefinition(ctx, survey.closesOn);
    repo.updateSurvey(survey.id, ctx.user.id, value);
    live.surveyChanged(survey);
    sendSurvey(ctx, 200, survey.id);
  });

  /** Opens or closes a survey: { "isOpen": true | false }. */
  authed('PATCH', '/surveys/:id', async (ctx) => {
    const survey = ownedSurvey(ctx);
    const body = await readJson(ctx.req);
    if (typeof body.isOpen !== 'boolean') throw validationFailed({ errors: [coded('validation.isOpenInvalid')] });
    repo.setSurveyOpen(survey.id, ctx.user.id, body.isOpen);
    live.surveyChanged(survey);
    sendSurvey(ctx, 200, survey.id);
  });

  authed('DELETE', '/surveys/:id', (ctx) => {
    const survey = ownedSurvey(ctx);
    repo.deleteSurvey(survey.id, ctx.user.id);
    live.surveyChanged(survey);
    sendNoContent(ctx.res);
  });

  authed('GET', '/surveys/:id/events', (ctx) => {
    const survey = ownedSurvey(ctx);
    live.stream(ctx.req, ctx.res, `survey:${survey.id}`);
  });

  authed('GET', '/surveys/:id/responses', (ctx) => {
    const survey = ownedSurvey(ctx);
    sendJson(ctx.res, 200, { responses: repo.listResponses(survey.id).map(responseJson) });
  });

  /** Idempotent: deleting a response that is already gone is still 204. */
  authed('DELETE', '/surveys/:id/responses/:responseId', (ctx) => {
    const survey = ownedSurvey(ctx);
    const responseId = Number(ctx.params.responseId);
    if (!Number.isSafeInteger(responseId)) throw new ApiError(404, 'error.notFound');
    repo.deleteResponse(survey.id, responseId);
    live.surveyChanged(survey);
    sendNoContent(ctx.res);
  });

  /** Key figures and chart data: the server counts, clients only draw. */
  authed('GET', '/surveys/:id/summary', (ctx) => {
    const survey = ownedSurvey(ctx);
    const responses = repo.listResponses(survey.id); // newest first
    const status = surveyStatus(survey, today());
    const named = responses.filter((r) => r.respondentName).length;
    sendJson(ctx.res, 200, {
      kpis: {
        total: responses.length,
        named,
        anonymous: responses.length - named,
        lastResponseAt: isoUtc(responses[0]?.submittedAt),
        status,
        closesOn: survey.closesOn,
        // Whole days until the closing date while open (0 = last day); null when closed or expired.
        daysLeft: status === 'open' ? daysBetween(today(), survey.closesOn) : null,
      },
      questions: summarize(survey.fields, responses).map(({ field, answered, counts }) => ({
        fieldId: field.id,
        label: field.label,
        type: field.type,
        // Checkbox answers can pick several options, so percentages may add up to more than 100.
        multiple: field.type === 'checkbox',
        answered,
        counts: counts.map(({ option, count }) => ({ option, count, percent: percent(count, answered) })),
      })),
    });
  });

  /** ?delimiter=comma|semicolon&lang=en|es (default: Accept-Language, then English). */
  authed('GET', '/surveys/:id/export.csv', (ctx) => {
    const survey = ownedSurvey(ctx);
    const query = ctx.url.searchParams;
    const delimiter = CSV_DELIMITERS[query.get('delimiter') ?? 'comma'];
    if (!delimiter) throw new ApiError(400, 'error.invalidParameter', { name: 'delimiter' });
    const lang = query.get('lang') ?? negotiateLanguage(ctx.req.headers['accept-language']);
    if (!isSupportedLanguage(lang)) throw new ApiError(400, 'error.invalidParameter', { name: 'lang' });

    const csv = toCsv(survey.fields, repo.listResponses(survey.id), delimiter, { t: createI18n(lang).t });
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sharevy-survey-${survey.id}-responses.csv"`,
    });
    // UTF-8 BOM so Excel detects accents correctly.
    ctx.res.end('﻿' + csv);
  });

  authed('GET', '/surveys/:id/qr.svg', async (ctx) => {
    const svg = await qrSvg(shareUrl(ownedSurvey(ctx)), QR_LABEL);
    ctx.res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    ctx.res.end(svg);
  });

  authed('GET', '/surveys/:id/qr.png', async (ctx) => {
    const survey = ownedSurvey(ctx);
    const png = await qrPng(shareUrl(survey));
    ctx.res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="sharevy-survey-${survey.id}-qr.png"`,
    });
    ctx.res.end(png);
  });
}
