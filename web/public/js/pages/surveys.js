import { icon } from '../components/icons.js';
import { surveyCards } from '../components/survey-cards.js';
import { h } from '../dom.js';

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
