import { ApiError } from '../api.js';
import { answerField, fieldError, respondentNameField } from '../components/answer-field.js';
import { icon } from '../components/icons.js';
import { errorList, resultPanel } from '../components/layout.js';
import { h, withParts } from '../dom.js';
import { checkAnswer, checkRespondentName } from '../validation.js';

/*
 * Respondent pages (no account): the form, and the closed / already answered / thanks results.
 * The device id (X-Device-Id) lets each device answer a survey once.
 */

const closedPanel = (survey, status, { t, formatDate }) => resultPanel({
  iconName: status === 'expired' ? 'calendar' : 'lock',
  heading: survey.title,
  children: [h('p', {}, status === 'expired' ? t('respond.closedOn', { date: formatDate(survey.closesOn) }) : t('respond.closed'))],
});

const alreadyAnsweredPanel = (survey, { t }) => resultPanel({
  iconName: 'check',
  ok: true,
  heading: survey.title,
  children: [h('p', {}, t('respond.alreadyAnswered')), h('p', { class: 'muted' }, t('respond.onePerDevice'))],
});

/** Replaces the page content with a result panel (closed, already answered) after a submission. */
function showResult(app, title, panel) {
  document.title = `${title} · Sharevy`;
  document.querySelector('main').replaceChildren(panel);
  window.scrollTo(0, 0);
}

/**
 * Inline checks for the form: the same rules and messages as the API, shown at once, without a
 * round trip. Errors use one markup for client checks and API answers: a .field-error under the
 * question and the .errors summary above the form.
 */
function attachValidation(form, entries, app, limits) {
  const { t, tn } = app;
  const shown = new Map(); // entry -> message shown now

  const valueOf = (entry) => {
    const inputs = [...entry.wrap.querySelectorAll('input, select, textarea')];
    if (entry.type === 'checkbox') return inputs.filter((i) => i.checked).map((i) => i.value);
    if (entry.type === 'radio' || entry.type === 'yesno') return inputs.find((i) => i.checked)?.value ?? '';
    return entry.control.value;
  };

  /** The message for one entry's current value, or undefined when it is valid. */
  function check(entry) {
    const problem = entry.type === 'name'
      ? checkRespondentName(entry.control.value, limits)
      : checkAnswer({ type: entry.type, required: entry.required, value: valueOf(entry), options: entry.options }, limits);
    return problem ? t(problem.key, problem.params) : undefined;
  }

  function show(entry, message) {
    const errorId = `${entry.control.id}_error`;
    entry.wrap.querySelector(':scope > .field-error')?.remove();
    if (message) {
      entry.wrap.append(fieldError(errorId, message));
      entry.wrap.classList.add('has-error');
      entry.control.setAttribute('aria-describedby', errorId);
      entry.control.setAttribute('aria-invalid', 'true');
      shown.set(entry, message);
    } else {
      entry.wrap.classList.remove('has-error');
      entry.control.removeAttribute('aria-describedby');
      entry.control.removeAttribute('aria-invalid');
      shown.delete(entry);
    }
  }

  /** The summary above the form: "Please check these N answers:" and a link to each one. */
  function renderSummary() {
    const old = form.previousElementSibling?.classList.contains('errors') ? form.previousElementSibling : null;
    const problems = entries.filter((entry) => shown.has(entry));
    if (!problems.length) {
      old?.remove();
      return;
    }
    const summary = errorList([
      tn('respond.checkAnswers', problems.length),
      ...problems.map((entry) => [h('a', { href: `#${entry.control.id}` }, entry.label), `: ${shown.get(entry)}`]),
    ]);
    if (old) old.replaceWith(summary);
    else form.before(summary);
  }

  function focusFirst() {
    const first = entries.find((entry) => shown.has(entry));
    if (!first) return false;
    first.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const focusable = first.control.matches('fieldset') ? first.control.querySelector('input') : first.control;
    focusable.focus({ preventScroll: true });
    return true;
  }

  // A question that shows an error updates as soon as its answer changes, and clears when valid.
  const recheck = (event) => {
    const entry = entries.find((e) => e.wrap.contains(event.target));
    if (!entry || !shown.has(entry)) return;
    const message = check(entry);
    if (message === shown.get(entry)) return;
    show(entry, message);
    renderSummary();
  };
  form.addEventListener('input', recheck);
  form.addEventListener('change', recheck);

  return {
    /** Checks every answer; true when all are valid. */
    validate() {
      for (const entry of entries) show(entry, check(entry));
      renderSummary();
      return !focusFirst();
    },
    /** Shows the API's problems (`fields`: question id or "respondentName" -> message). */
    showServerErrors(messages) {
      for (const entry of entries) show(entry, messages[entry.key]);
      renderSummary();
      focusFirst();
    },
    valueOf,
  };
}

/** Container: the survey form for /s/:token. */
export async function respondPage(app, { params, signal }) {
  const { t } = app;
  const { token } = params;
  const deviceId = app.deviceId();
  const { survey } = await app.api.get(`/public/surveys/${encodeURIComponent(token)}`, { deviceId, signal });

  if (survey.status !== 'open') return { title: survey.title, body: [closedPanel(survey, survey.status, app.i18n)] };
  if (survey.alreadyAnswered) return { title: survey.title, body: [alreadyAnsweredPanel(survey, app.i18n)] };

  const { limits } = app.meta;
  const nameField = respondentNameField(app.i18n, limits);
  const questions = survey.fields.map((field, i) => answerField(field, i, app.i18n, limits));
  const submit = h('button', { type: 'submit', class: 'big block' }, icon('check'), ` ${t('respond.submit')}`);
  // The browser's own bubbles would compete with the inline messages.
  const form = h('form', { class: 'stack respondent-form', noValidate: true }, nameField, questions, submit);

  const entries = [
    { key: 'respondentName', wrap: nameField, type: 'name', control: nameField.querySelector('#respondent_name'), label: t('respond.yourName') },
    ...survey.fields.map((field, i) => ({
      key: field.id,
      wrap: questions[i],
      type: field.type,
      required: field.required,
      options: field.options,
      label: field.label,
      control: questions[i].querySelector(`[id="fld_${field.id}"]`),
    })),
  ];
  const checks = attachValidation(form, entries, app, limits);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!checks.validate()) return;
    const answers = Object.fromEntries(entries.filter((e) => e.type !== 'name').map((e) => [e.key, checks.valueOf(e)]));
    submit.disabled = true;
    try {
      const result = await app.api.post(`/public/surveys/${encodeURIComponent(token)}/responses`,
        { respondentName: entries[0].control.value, answers }, { deviceId });
      if (result?.deviceId) app.rememberDevice(result.deviceId);
      await app.navigate(`/s/${encodeURIComponent(token)}/thanks`);
    } catch (err) {
      if (!(err instanceof ApiError)) return app.showError(err, true);
      if (err.code === 'already_answered') return showResult(app, survey.title, alreadyAnsweredPanel(survey, app.i18n));
      if (err.code === 'survey_closed' || err.code === 'survey_expired') {
        return showResult(app, survey.title, closedPanel(survey, err.code === 'survey_expired' ? 'expired' : 'closed', app.i18n));
      }
      if (err.fields) {
        const messages = Object.fromEntries(Object.entries(err.fields).map(([key, problem]) => [key, app.error(new ApiError(422, problem))]));
        return checks.showServerErrors(messages);
      }
      return app.showError(err, true);
    } finally {
      submit.disabled = false;
    }
  });

  const hasRequired = survey.fields.some((f) => f.required);
  return {
    title: survey.title,
    body: [
      h('div', { class: 'panel intro' },
        h('h1', {}, survey.title),
        survey.description ? h('p', { class: 'description' }, survey.description) : null,
        h('p', { class: 'meta' }, icon('calendar'), ` ${t('respond.openUntil', { date: app.i18n.formatDate(survey.closesOn) })}`),
        hasRequired ? h('p', { class: 'hint' }, withParts(t('respond.requiredHint'), { mark: h('span', { class: 'req' }, '*') })) : null),
      form,
    ],
  };
}

/** Container: /s/:token/thanks. */
export async function thanksPage(app, { params, signal }) {
  const { t } = app;
  const { survey } = await app.api.get(`/public/surveys/${encodeURIComponent(params.token)}`, { deviceId: app.deviceId(), signal });
  return {
    title: t('respond.thanksTitle'),
    body: [resultPanel({
      iconName: 'check',
      ok: true,
      heading: t('respond.thanksHeading'),
      children: [
        h('p', {}, withParts(t('respond.thanksSent'), { title: h('strong', {}, survey.title) })),
        h('p', { class: 'muted' }, t('respond.thanksClose')),
      ],
    })],
  };
}
