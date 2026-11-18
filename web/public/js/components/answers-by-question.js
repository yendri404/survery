import { h, slot } from '../dom.js';
import { formatTimestamp } from '../format.js';
import { icon } from './icons.js';
import { answerText, deleteResponseForm, respondentName, responsesTable } from './results.js';

/*
 * Every answer, seen two ways: the table (one column per question) or "by question" (one question
 * at a time, with each person's answer below it), which needs no sideways scrolling. A switch above
 * them picks the view. The container keeps the choice (and the question shown) so live refreshes
 * and later visits keep them; these functions only draw them and report a new pick.
 */

/** Past this many questions the table gets too wide to read comfortably. */
const MANY_QUESTIONS = 5;

/** The view shown until the person picks one: "by question" only for surveys with many questions. */
export const defaultAnswersView = (fieldCount) => (fieldCount > MANY_QUESTIONS ? 'byQuestion' : 'table');

const VIEWS = ['table', 'byQuestion'];

const isAnswered = (value) => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value) !== '');

/** The responses that answered `field` (in the order given: newest first) and how many left it empty. */
export function answersForQuestion(field, responses) {
  const answered = responses.filter((r) => isAnswered(r.answers[field.id]));
  return { answered, unanswered: responses.length - answered.length };
}

/** One person's answer: the answer itself, then who, which response and when. */
const answerItem = (field, response, t, onDelete) => h('li', { class: 'answer-item' },
  h('div', { class: 'answer-value' }, answerText(field, response.answers[field.id], t)),
  h('p', { class: 'answer-meta' },
    h('span', { class: 'answer-name' }, respondentName(response, t)),
    h('span', {}, `#${response.number}`),
    h('time', { datetime: response.submittedAt }, formatTimestamp(response.submittedAt))),
  onDelete && h('div', { class: 'answer-actions' }, deleteResponseForm(response, t, onDelete)));

function questionAnswers(field, responses, { t, tn }, onDelete) {
  const { answered, unanswered } = answersForQuestion(field, responses);
  return h('div', { class: 'question-answers' },
    unanswered ? h('p', { class: 'hint unanswered' }, tn('detail.unanswered', unanswered)) : null,
    answered.length ? h('ul', { class: 'answer-list' }, answered.map((r) => answerItem(field, r, t, onDelete))) : null);
}

/**
 * "By question": a picker of every question ("1. Label") with previous/next buttons, and every
 * answer to the chosen one. `question` is the id of the question to show (the first one when
 * missing or deleted); `onQuestion(id)` reports a new pick. Without `onDelete` it is read-only.
 */
export function answersByQuestion(fields, responses, i18n, { question, onQuestion, onDelete } = {}) {
  const { t } = i18n;
  let index = Math.max(0, fields.findIndex((f) => f.id === question));
  const select = h('select', { id: 'answers-question', onchange: (e) => show(fields.findIndex((f) => f.id === e.currentTarget.value)) },
    fields.map((f, i) => h('option', { value: f.id }, `${i + 1}. ${f.label}`)));
  const prev = h('button', { type: 'button', class: 'icon-button', 'aria-label': t('detail.previousQuestion'), title: t('detail.previousQuestion'), onclick: () => show(index - 1) }, icon('back'));
  const next = h('button', { type: 'button', class: 'icon-button', 'aria-label': t('detail.nextQuestion'), title: t('detail.nextQuestion'), onclick: () => show(index + 1) }, icon('forward'));
  const list = slot(questionAnswers(fields[index], responses, i18n, onDelete));
  const sync = () => {
    select.value = fields[index].id;
    // A button that turns disabled under the keyboard passes the focus to the picker.
    if ((index === 0 && document.activeElement === prev) || (index === fields.length - 1 && document.activeElement === next)) select.focus();
    prev.disabled = index === 0;
    next.disabled = index === fields.length - 1;
  };
  function show(i) {
    if (i < 0 || i >= fields.length || i === index) return;
    index = i;
    sync();
    list.set(questionAnswers(fields[index], responses, i18n, onDelete));
    onQuestion?.(fields[index].id);
  }
  sync();
  return h('div', { class: 'by-question' },
    h('div', { class: 'question-picker' },
      h('label', { for: 'answers-question' }, t('detail.question')),
      h('div', { class: 'picker-row' }, prev, select, next)),
    list.node);
}

/**
 * The answers with the view switch ("Table" / "By question", toggle buttons with aria-pressed).
 * `state` ({ view, question }) is what the person picked before (null: never), `onChange(change)`
 * reports a new pick ({ view } or { question }); a view never picked follows defaultAnswersView().
 * `signal` ends the table's size watching when the page is left. No answers: the empty state only.
 */
export function answersSection(fields, responses, i18n, { state = {}, onChange, onDelete, signal } = {}) {
  const { t } = i18n;
  if (!responses.length || !fields.length) return responsesTable(fields, responses, i18n, onDelete);
  const current = {
    view: VIEWS.includes(state.view) ? state.view : defaultAnswersView(fields.length),
    question: state.question ?? null,
  };
  const build = (view) => (view === 'table'
    ? responsesTable(fields, responses, i18n, onDelete, { signal })[1]
    : answersByQuestion(fields, responses, i18n, {
      question: current.question,
      onDelete,
      onQuestion: (question) => {
        current.question = question;
        onChange?.({ question });
      },
    }));
  const body = slot(build(current.view));
  const buttons = VIEWS.map((view) => h('button', {
    type: 'button',
    'aria-pressed': String(view === current.view),
    onclick: () => pick(view),
  }, t(view === 'table' ? 'detail.viewTable' : 'detail.viewByQuestion')));
  function pick(view) {
    if (view === current.view) return;
    current.view = view;
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(VIEWS[i] === view)));
    body.set(build(view));
    onChange?.({ view });
  }
  return h('div', { class: 'answers' },
    h('div', { class: 'answers-head' },
      h('h3', {}, t('detail.allAnswers')),
      h('div', { class: 'view-switch', role: 'group', 'aria-label': t('detail.answersView') }, buttons)),
    body.node);
}
