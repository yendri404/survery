import { ApiError } from '../api.js';
import { createBuilder } from '../components/builder.js';
import { icon } from '../components/icons.js';
import { backLink, errorList, notice } from '../components/layout.js';
import { h } from '../dom.js';
import { addDays } from '../format.js';

/** Container: new survey (/surveys/new) or edit (/surveys/:id/edit). */
export async function editorPage(app, { params, signal }) {
  const { t } = app;
  const editing = Boolean(params.id);
  // Fresh rules and the server's date: closing dates are compared with the server's "today".
  const [meta, survey] = await Promise.all([
    app.api.get('/meta', { signal }),
    editing ? app.api.get(`/surveys/${params.id}`, { signal }).then((r) => r.survey) : null,
  ]);
  const { limits, today } = meta;
  // An expired survey keeps its past date valid until the creator changes it.
  const minDate = survey?.closesOn && survey.closesOn < today ? survey.closesOn : today;
  const cancel = editing ? `/surveys/${survey.id}` : '/surveys';

  const title = h('input', { name: 'title', value: survey?.title ?? '', required: true, maxlength: limits.title, placeholder: t('editor.titlePlaceholder') });
  const description = h('textarea', { name: 'description', rows: 3, maxlength: limits.description });
  description.value = survey?.description ?? '';
  const closesOn = h('input', { type: 'date', name: 'closes_on', value: survey?.closesOn ?? addDays(today, meta.defaultOpenDays), min: minDate, required: true });

  const basicsSection = h('section', { class: 'panel stack editor-basics' },
    h('h2', {}, t('editor.basics')),
    h('label', {}, `${t('editor.titleLabel')} `, title),
    h('label', {}, `${t('editor.description')} `, h('span', { class: 'hint' }, t('editor.descriptionHint')), description),
    h('label', {}, `${t('editor.closingDate')} `, h('span', { class: 'hint' }, t('editor.closingDateHint')), closesOn));

  const submit = h('button', { type: 'submit', class: 'big' }, icon('check'), ` ${editing ? t('editor.save') : t('editor.create')}`);
  const form = h('form', { class: 'stack editor-form', id: 'survey-form', noValidate: true }, basicsSection);

  // Title and closing date are checked on submit like the questions, with the API's messages.
  const builder = createBuilder({
    fields: survey?.fields ?? [],
    types: meta.fieldTypes.map((type) => [type, t(`fieldType.${type}`)]),
    choiceTypes: meta.choiceTypes,
    limits,
    t,
    basics: [
      { control: title, check: () => (title.value.trim() ? undefined : t('validation.titleRequired')) },
      {
        control: closesOn,
        check: () => {
          if (closesOn.validity.badInput) return t('validation.closingDateInvalid');
          if (!closesOn.value) return t('validation.required');
          // YYYY-MM-DD strings compare correctly as text; min is today (or the current expired date).
          return closesOn.min && closesOn.value < closesOn.min ? t('validation.closingDatePast') : undefined;
        },
      },
    ],
  });
  form.append(
    h('section', { class: 'stack editor-questions' }, h('h2', {}, t('editor.questions')), builder.element),
    h('div', { class: 'form-footer' }, submit, h('a', { class: 'button big secondary', href: cancel }, t('editor.cancel'))),
  );

  /** API problems (a list, in the order the API found them) in a box above the form. */
  function showErrors(messages) {
    const old = form.previousElementSibling?.classList.contains('errors') ? form.previousElementSibling : null;
    const box = errorList(messages);
    if (old) old.replaceWith(box);
    else form.before(box);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // Stopping here keeps what was typed on screen and saves a round trip to the API.
    const invalid = builder.validate();
    if (invalid) {
      invalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
      invalid.focus({ preventScroll: true });
      return;
    }
    submit.disabled = true;
    try {
      const body = { title: title.value, description: description.value, closesOn: closesOn.value, fields: builder.value() };
      const saved = editing ? await app.api.put(`/surveys/${survey.id}`, body) : await app.api.post('/surveys', body);
      await app.navigate(`/surveys/${saved.survey.id}?msg=${editing ? 'saved' : 'created'}`);
    } catch (err) {
      const problems = err instanceof ApiError && err.errors?.length ? err.errors.map((p) => app.error(new ApiError(422, p))) : [app.error(err)];
      showErrors(problems);
    } finally {
      submit.disabled = false;
    }
  });

  return {
    title: editing ? t('editor.editTitle', { title: survey.title }) : t('editor.newTitle'),
    body: [
      backLink(cancel, t('editor.back')),
      h('h1', {}, editing ? t('editor.editHeading') : t('editor.newTitle')),
      editing && survey.responseCount > 0 ? notice('alert', t('editor.hasAnswers', { count: survey.responseCount })) : null,
      form,
    ],
  };
}
