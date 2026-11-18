import { closingLine, resultsContent, surveyDescription, surveyHeading } from '../components/survey-detail.js';
import { h, slot } from '../dom.js';

/**
 * Container: a survey's public results (/r/<token>), read-only and without an account. It shows what
 * the creator's results page shows (figures, charts, every answer with names) and nothing to change.
 * When the creator makes the results private again, the next live update shows the "not public" panel.
 */
export async function publicResultsPage(app, { params, signal }) {
  const { i18n } = app;
  const path = `/public/results/${encodeURIComponent(params.token)}`;

  const load = async () => {
    const [survey, summary, responses] = await Promise.all([
      app.api.get(path, { signal }).then((r) => r.survey),
      app.api.get(`${path}/summary`, { signal }),
      app.api.get(`${path}/responses`, { signal }).then((r) => r.responses),
    ]);
    return { survey, summary, responses };
  };
  const data = await load();

  // ---------- Survey state shown outside the results (kept current by live updates) ----------
  const stateParts = [(s) => surveyHeading(s, i18n), (s) => closingLine(s, i18n), surveyDescription];
  const slots = stateParts.map((build) => slot(build(data.survey)));
  const toneOf = (survey) => (survey.status === 'open' ? 'open' : undefined);
  const showSurvey = (survey) => {
    stateParts.forEach((build, i) => slots[i].set(build(survey)));
    app.setTone(toneOf(survey));
  };

  const results = h('section', { id: 'responses' }, resultsContent(data, i18n));

  return {
    title: data.survey.title,
    tone: toneOf(data.survey),
    body: [...slots.map((s) => s.node), h('div', { class: 'detail-main public-results-view' }, results)],
    mounted: () => {
      app.liveRegion(results, `${path}/events`, async () => {
        let fresh;
        try {
          fresh = await load();
        } catch (err) {
          // Made private (or deleted) meanwhile: render the page again, which shows why.
          if (err?.status === 404 && !signal.aborted) app.render({ transition: false });
          throw err;
        }
        if (!signal.aborted) showSurvey(fresh.survey);
        return resultsContent(fresh, i18n);
      }, signal);
    },
  };
}
