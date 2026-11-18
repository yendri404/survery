import { icon } from '../components/icons.js';
import { errorList } from '../components/layout.js';
import { surveyCards } from '../components/survey-cards.js';
import { h } from '../dom.js';
import { TEMPLATE_MAX_BYTES, parseTemplate } from '../template.js';

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
  // Import a template: read the file here, then open the new-survey editor filled with it (nothing
  // is saved until the creator reviews it and presses Create; the API checks it then).
  const importProblem = h('div', { 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = ''; // the same file can be picked again after fixing it
    if (!file) return;
    const parsed = file.size > TEMPLATE_MAX_BYTES ? { error: 'template.tooLarge' } : parseTemplate(await file.text());
    if (parsed.error) {
      importProblem.replaceChildren(errorList([t(parsed.error)]) ?? '');
      return;
    }
    app.pendingTemplate = { template: parsed.template, fileName: file.name };
    await app.navigate('/surveys/new');
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
