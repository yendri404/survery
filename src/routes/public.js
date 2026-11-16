import { HttpError, readForm, redirect, sendHtml } from '../http.js';
import { validateAnswers } from '../surveys.js';

/** Respondent-facing routes: no account required. */
export function registerPublicRoutes({ route, repo, views }) {
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

    const { answers, errors } = validateAnswers(survey.fields, form);
    if (Object.keys(errors).length) {
      return sendHtml(ctx.res, 422, views.publicFormPage({ survey, values: answers, errors }));
    }
    repo.addResponse(survey.id, answers);
    redirect(ctx.res, `/s/${encodeURIComponent(survey.publicToken)}/thanks`);
  });

  route('GET', '/s/:token/thanks', (ctx) => {
    sendHtml(ctx.res, 200, views.thanksPage({ survey: surveyByToken(ctx) }));
  });
}
