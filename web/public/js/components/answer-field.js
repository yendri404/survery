import { h } from '../dom.js';
import { NUMBER_TEXT, normalizeNumberText, numberInsert, stepNumber } from '../number-input.js';
import { icon } from './icons.js';

/*
 * One question of the respondent form, in the markup style.css expects:
 * <div class="field" data-type …> with a label (or fieldset + legend for choices) and the control
 * whose id is "fld_<question id>". Error messages go in a .field-error paragraph under it.
 */

const INPUT_TYPES = { text: 'text', email: 'email', date: 'date' };
const INPUT_MODES = { number: 'decimal', email: 'email' };

/**
 * Number questions: a text input with a decimal keyboard (a number input hides the typed text
 * and the cursor from scripts). Letters, "e", "+" and a second point are blocked while typing,
 * pasting or dropping; a comma becomes a point; Up/Down arrows add or subtract 1.
 */
function numberOnly(input) {
  let lastGood = NUMBER_TEXT.test(input.value) ? input.value : '';
  input.addEventListener('beforeinput', (event) => {
    if (!event.inputType.startsWith('insert') || event.inputType === 'insertCompositionText') return;
    const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const decision = numberInsert(input.value, start, end, data);
    if (!decision.allow) {
      event.preventDefault();
    } else if (decision.rewrite !== undefined) {
      // Insert the cleaned text ourselves (comma -> point) and report it like a normal edit.
      event.preventDefault();
      input.setRangeText(decision.rewrite, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  // Safety net for what beforeinput cannot cancel (IME composition, autofill, old browsers).
  input.addEventListener('input', () => {
    const value = normalizeNumberText(input.value);
    if (NUMBER_TEXT.test(value)) {
      if (value !== input.value) input.value = value;
      lastGood = value;
    } else {
      input.value = lastGood;
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const next = stepNumber(input.value, event.key === 'ArrowUp' ? 1 : -1);
    if (next === undefined) return;
    event.preventDefault();
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

// Keys that move a slider; pressing one at an end changes nothing but still counts as an answer.
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Scale questions: a native slider from min to max (step 1) that starts unanswered. A range input
 * always holds a value, so it has no name and is never sent: the hidden input `name` gets its value
 * only once the person moves it (pointer, touch or keyboard). Until then the answer is empty and
 * screen readers hear "Move the slider to choose" as the value.
 */
function scaleControl(field, id, name, t) {
  const { min, max } = field;
  const answer = h('input', { type: 'hidden', name, value: '' });
  const current = h('span', { class: 'scale-value', 'aria-hidden': 'true' }, '–');
  const status = h('p', { class: 'hint scale-status', 'aria-hidden': 'true' }, t('respond.scaleUnanswered'));
  const range = h('input', {
    id, type: 'range', class: 'scale-range', min, max, step: 1, value: Math.round((min + max) / 2),
    'aria-valuetext': t('respond.scaleUnanswered'),
  });
  const box = h('div', { class: 'scale-control is-unset' },
    h('span', { class: 'scale-end', 'aria-hidden': 'true' }, String(min)),
    range,
    h('span', { class: 'scale-end', 'aria-hidden': 'true' }, String(max)),
    current);

  const commit = () => {
    const first = !answer.value;
    answer.value = range.value;
    current.textContent = range.value;
    range.setAttribute('aria-valuetext', range.value);
    if (!first) return;
    box.classList.remove('is-unset');
    status.hidden = true;
    // A press or click that did not move the thumb fires no input event: report the new answer.
    range.dispatchEvent(new Event('change', { bubbles: true }));
  };
  range.addEventListener('input', commit);
  range.addEventListener('change', commit);
  range.addEventListener('pointerup', commit);
  range.addEventListener('keyup', (event) => { if (SLIDER_KEYS.has(event.key)) commit(); });
  return [box, status, answer];
}

/** The answer of a scale question: '' until the slider was moved. */
export const scaleAnswer = (wrap) => wrap.querySelector('input[type="hidden"]')?.value ?? '';

/** The control(s) of question `field` (number `index` + 1). */
export function answerField(field, index, { t }, limits) {
  const name = `f_${field.id}`;
  const id = `fld_${field.id}`;
  const mark = field.required ? [' ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')] : [];
  const number = [h('span', { class: 'q-number' }, `${index + 1}.`), ' '];
  const wrap = (...inner) => h('div', { class: 'field', 'data-type': field.type, 'data-required': field.required, 'data-label': field.label }, ...inner);

  switch (field.type) {
    case 'radio':
    case 'checkbox':
    case 'yesno': {
      const yesno = field.type === 'yesno';
      const options = yesno ? ['yes', 'no'] : field.options;
      const inputs = options.map((option, i) => h('label', { class: 'choice' },
        h('input', { type: field.type === 'checkbox' ? 'checkbox' : 'radio', name, value: option, required: field.type !== 'checkbox' && i === 0 && field.required }),
        h('span', {}, yesno ? t(`answer.${option}`) : option)));
      return wrap(h('fieldset', { id },
        h('legend', {}, number, field.label, mark),
        field.type === 'checkbox' ? h('span', { class: 'hint' }, t('respond.chooseMany')) : null,
        h('div', { class: yesno ? 'choices yesno' : 'choices' }, inputs)));
    }
    case 'select':
      return wrap(
        h('label', { for: id }, number, field.label, mark),
        h('select', { id, name, required: field.required },
          h('option', { value: '' }, t('respond.chooseOption')),
          field.options.map((o) => h('option', { value: o }, o))));
    case 'textarea':
      return wrap(
        h('label', { for: id }, number, field.label, mark),
        h('textarea', { id, name, rows: 4, maxlength: limits.textarea, required: field.required }));
    case 'scale':
      return wrap(h('label', { for: id }, number, field.label, mark), scaleControl(field, id, name, t));
    case 'number':
      return wrap(
        h('label', { for: id }, number, field.label, mark),
        numberOnly(h('input', { id, type: 'text', name, inputmode: INPUT_MODES.number, required: field.required })));
    default: {
      const input = h('input', {
        id, type: INPUT_TYPES[field.type] ?? 'text', name, maxlength: field.type === 'text' ? limits.text : undefined,
        inputmode: INPUT_MODES[field.type], required: field.required,
      });
      return wrap(h('label', { for: id }, number, field.label, mark), input);
    }
  }
}

/** The optional respondent name, visually set apart from the questions. */
export const respondentNameField = ({ t }, limits) => h('div', { class: 'field respondent-name' },
  h('label', { for: 'respondent_name' }, `${t('respond.yourName')} `, h('span', { class: 'muted' }, t('respond.optional'))),
  h('span', { class: 'hint' }, t('respond.anonymousHint')),
  h('input', { id: 'respondent_name', name: 'respondent_name', maxlength: limits.respondentName, autocomplete: 'name' }));

/** Error message markup, shared by client checks and API errors. */
export const fieldError = (id, message) => h('p', { class: 'field-error', id }, icon('alert'), ` ${message}`);
