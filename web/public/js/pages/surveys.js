import { closingText, emptyState, statusBadge } from '../components/layout.js';
import { icon } from '../components/icons.js';
import { h } from '../dom.js';

/** Presentational: the creator's surveys as cards, or the empty state. */
export function surveyCards(surveys, i18n) {
  const { t, tn } = i18n;
  if (!surveys.length) {
    return emptyState(t('list.empty'), h('a', { class: 'button big', href: '/surveys/new' }, icon('plus'), ` ${t('list.createFirst')}`));
  }
  return h('ul', { class: 'cards' }, surveys.map((survey) => h('li', {},
    h('a', { class: 'card card-link', href: `/surveys/${survey.id}` },
      h('span', { class: 'card-title' }, survey.title),
      statusBadge(survey.status, t),
      h('span', { class: 'muted' }, `${tn('list.responses', survey.responseCount)} · ${closingText(survey.closesOn, survey.status, i18n)}`)))));
}

/** Container: loads the list and keeps it live (new answers, other tabs' changes). */
export async function surveyListPage(app, { signal }) {
  const { t } = app;
  const load = async () => surveyCards((await app.api.get('/surveys', { signal })).surveys, app.i18n);
  const region = h('div', { id: 'survey-list' }, await load());
  return {
    title: t('list.title'),
    body: [
      h('div', { class: 'page-head' },
        h('h1', {}, t('list.title')),
        h('a', { class: 'button', href: '/surveys/new' }, icon('plus'), ` ${t('list.newSurvey')}`)),
      region,
    ],
    mounted: () => app.liveRegion(region, '/surveys/events', load, signal),
  };
}
