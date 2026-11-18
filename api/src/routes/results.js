import { ApiError } from '../errors.js';
import { sendJson } from '../http.js';
import { surveyStatus } from '../surveys.js';
import { responseJson, summaryJson } from './surveys.js';

/**
 * Public results: read-only, no account. A survey's creator turns them on (PATCH /surveys/:id
 * { publicResults: true }) and shares the results token; anyone with it sees what the creator
 * sees on the results page, names included. A private (or revoked) token is "not found".
 */
export function registerResultsRoutes({ route, repo, today, live }) {
  function surveyByResultsToken(ctx) {
    const survey = repo.getSurveyByResultsToken(ctx.params.token);
    if (!survey) throw new ApiError(404, 'results.notFound');
    return survey;
  }

  /** What the results page shows about the survey itself: never the answer token or the owner. */
  route('GET', '/public/results/:token', (ctx) => {
    const survey = surveyByResultsToken(ctx);
    sendJson(ctx.res, 200, {
      survey: {
        title: survey.title,
        description: survey.description,
        closesOn: survey.closesOn,
        requireName: survey.requireName,
        status: surveyStatus(survey, today()),
        fields: survey.fields,
      },
    });
  });

  route('GET', '/public/results/:token/summary', (ctx) => {
    const survey = surveyByResultsToken(ctx);
    sendJson(ctx.res, 200, summaryJson(survey, repo.listResponses(survey.id), today()));
  });

  route('GET', '/public/results/:token/responses', (ctx) => {
    const survey = surveyByResultsToken(ctx);
    sendJson(ctx.res, 200, { responses: repo.listResponses(survey.id).map(responseJson) });
  });

  /** The same "something changed" events as the creator's results page (new answers, edits, revocation). */
  route('GET', '/public/results/:token/events', (ctx) => {
    const survey = surveyByResultsToken(ctx);
    // Ends when the link is turned off, so a revoked link does not keep learning when answers arrive.
    const token = ctx.params.token;
    live.stream(ctx.req, ctx.res, `survey:${survey.id}`, { allowed: () => repo.getSurveyByResultsToken(token)?.id === survey.id });
  });
}
