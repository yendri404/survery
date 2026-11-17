import { icon } from '../components/icons.js';
import { surveyCards } from '../components/survey-cards.js';
import { h } from '../dom.js';

/** Container: loads the list, keeps it live (new answers, other tabs' changes), closes, reopens and deletes surveys. */
export async function surveyListPage(app, { signal }) {
  const { t } = app;
  // Same confirmation as the survey page: the survey and all its answers go away for good.
  const onDelete = async (survey) => {
    if (!window.confirm(t('list.deleteConfirm', { title: survey.title }))) return;
    try {
      await app.api.del(`/surveys/${survey.id}`);
      await app.navigate('/surveys?msg=deleted', { replace: true });
    } catch (err) {
      app.showError(err);
    }
  };
  // Same as the survey page: closing stops new answers at once, reopening accepts them again.
  const onToggle = async (survey) => {
    try {
      await app.api.patch(`/surveys/${survey.id}`, { isOpen: !survey.isOpen });
      await app.navigate(`/surveys?msg=${survey.isOpen ? 'closed' : 'opened'}`, { replace: true });
    } catch (err) {
      app.showError(err);
    }
  };
  const load = async () => surveyCards((await app.api.get('/surveys', { signal })).surveys, app.i18n, { onToggle, onDelete });
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
