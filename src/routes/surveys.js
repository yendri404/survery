import { newToken } from '../auth.js';
import { authed, authedPost } from '../guards.js';
import { HttpError, redirect, sendHtml } from '../http.js';
import { parseSurveyInput, toCsv } from '../surveys.js';

export function registerSurveyRoutes({ route, repo, config, views }) {
  const session = (ctx) => ({ user: ctx.user, csrf: ctx.session.csrf_token });

  function ownedSurvey(ctx) {
    const id = Number(ctx.params.id);
    const survey = Number.isSafeInteger(id) ? repo.getOwnedSurvey(id, ctx.user.id) : undefined;
    if (!survey) throw new HttpError(404, 'Survey not found.');
    return survey;
  }

  function shareUrl(ctx, survey) {
    const base = config.baseUrl || `http://${ctx.req.headers.host ?? 'localhost'}`;
    return `${base}/s/${survey.publicToken}`;
  }

  const editorInput = (form) => ({
    title: form.get('title') ?? '',
    description: form.get('description') ?? '',
    fieldsJson: form.get('fields_json') ?? '[]',
  });

  route('GET', '/surveys', authed((ctx) => {
    sendHtml(ctx.res, 200, views.surveyListPage({ ...session(ctx), surveys: repo.listSurveys(ctx.user.id) }));
  }));

  route('GET', '/surveys/new', authed((ctx) => {
    sendHtml(ctx.res, 200, views.surveyEditorPage({
      ...session(ctx), values: { title: '', description: '', fieldsJson: '[]' },
    }));
  }));

  route('POST', '/surveys', authedPost((ctx, form) => {
    const input = editorInput(form);
    const { value, errors } = parseSurveyInput(input);
    if (errors.length) return sendHtml(ctx.res, 422, views.surveyEditorPage({ ...session(ctx), values: input, errors }));
    const id = repo.createSurvey({ ownerId: ctx.user.id, publicToken: newToken(18), ...value });
    redirect(ctx.res, `/surveys/${id}`);
  }));

  route('GET', '/surveys/:id', authed((ctx) => {
    const survey = ownedSurvey(ctx);
    sendHtml(ctx.res, 200, views.surveyDetailPage({
      ...session(ctx), survey, responses: repo.listResponses(survey.id), shareUrl: shareUrl(ctx, survey),
    }));
  }));

  route('GET', '/surveys/:id/edit', authed((ctx) => {
    const survey = ownedSurvey(ctx);
    sendHtml(ctx.res, 200, views.surveyEditorPage({
      ...session(ctx),
      survey,
      values: { title: survey.title, description: survey.description, fieldsJson: JSON.stringify(survey.fields) },
    }));
  }));

  route('POST', '/surveys/:id', authedPost((ctx, form) => {
    const survey = ownedSurvey(ctx);
    const input = editorInput(form);
    const { value, errors } = parseSurveyInput(input);
    if (errors.length) return sendHtml(ctx.res, 422, views.surveyEditorPage({ ...session(ctx), survey, values: input, errors }));
    repo.updateSurvey(survey.id, ctx.user.id, value);
    redirect(ctx.res, `/surveys/${survey.id}`);
  }));

  route('POST', '/surveys/:id/toggle', authedPost((ctx) => {
    const survey = ownedSurvey(ctx);
    repo.setSurveyOpen(survey.id, ctx.user.id, !survey.isOpen);
    redirect(ctx.res, `/surveys/${survey.id}`);
  }));

  route('POST', '/surveys/:id/delete', authedPost((ctx) => {
    const survey = ownedSurvey(ctx);
    repo.deleteSurvey(survey.id, ctx.user.id);
    redirect(ctx.res, '/surveys');
  }));

  route('POST', '/surveys/:id/responses/:responseId/delete', authedPost((ctx) => {
    const survey = ownedSurvey(ctx);
    const responseId = Number(ctx.params.responseId);
    if (Number.isSafeInteger(responseId)) repo.deleteResponse(survey.id, responseId);
    redirect(ctx.res, `/surveys/${survey.id}`);
  }));

  route('GET', '/surveys/:id/export.csv', authed((ctx) => {
    const survey = ownedSurvey(ctx);
    const delimiter = ctx.url.searchParams.get('delimiter') === 'semicolon' ? ';' : ',';
    const csv = toCsv(survey.fields, repo.listResponses(survey.id), delimiter);
    const filename = `survey-${survey.id}-responses.csv`;
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    // UTF-8 BOM so Excel detects accents correctly.
    ctx.res.end('﻿' + csv);
  }));
}
