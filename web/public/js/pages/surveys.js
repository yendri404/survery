import { icon } from '../components/icons.js';
import { errorList } from '../components/layout.js';
import { surveyCards } from '../components/survey-cards.js';
import { h } from '../dom.js';
import { ApiError } from '../api.js';
import { readTemplateFile } from '../template.js';

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
  // Import a template: read the file, let the API check it was exported by this Sharevy and not
  // changed, then open the new-survey editor filled with it (nothing is saved until Create).
  const importProblem = h('div', { 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = ''; // the same file can be picked again after fixing it
    if (!file) return;
    const refuse = (message) => importProblem.replaceChildren(errorList([message]) ?? '');
    const data = await readTemplateFile(file);
    if (!data) return refuse(t('template.unsupported'));
    try {
      const { template } = await app.api.post('/templates/check', data);
      app.pendingTemplate = { template, fileName: file.name };
      await app.navigate('/surveys/new');
    } catch (err) {
      // Any refusal of the file itself is "unsupported"; network or server trouble says so instead.
      if (err instanceof ApiError && err.status === 401) return;
      refuse(err instanceof ApiError && err.status >= 400 && err.status < 500 ? t('template.unsupported') : app.error(err));
    }
  });
  const load = async () => surveyCards((await app.api.get('/surveys', { signal })).surveys, app.i18n, { onToggle, onDelete });
  const region = h('div', { id: 'survey-list' }, await load());
  return {
    title: t('list.title'),
    body: [
      h('div', { class: 'page-head' },
        h('h1', {}, t('list.title')),
        h('div', { class: 'page-actions' },
          h('button', { type: 'button', class: 'secondary', onclick: () => fileInput.click() }, icon('upload'), ` ${t('list.importTemplate')}`),
          h('a', { class: 'button', href: '/surveys/new' }, icon('plus'), ` ${t('list.newSurvey')}`)),
        fileInput),
      importProblem,
      region,
    ],
    mounted: () => app.liveRegion(region, '/surveys/events', load, signal),
  };
}
