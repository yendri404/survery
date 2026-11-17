import { h } from '../dom.js';
import { NUMBER_TEXT, normalizeNumberText, numberInsert, stepNumber } from '../number-input.js';
import { icon } from './icons.js';

/*
 * One question of the respondent form, with the same markup as the single-server version:
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
