import { h } from '../dom.js';
import { icon } from './icons.js';

/*
 * Question builder for the survey editor: add, move, duplicate and delete questions, with the
 * same live warnings as the API's rules (repeated questions and options while typing; empty
 * question text and missing options after a submit attempt). The API checks everything again.
 */

// Same rule as the API (api/src/surveys.js): equal after trimming, ignoring case.
const sameTextKey = (text) => text.trim().toLocaleLowerCase();
const optionLines = (text) => text.split('\n').map((o) => o.trim()).filter(Boolean);
const blank = () => ({ id: '', label: '', type: 'text', required: false, options: '' });

/**
 * `fields`: the survey's questions (API shape). `types`: [[type, label], ...] in menu order.
 * `basics`: [{ control, check() -> message | undefined }] for the title and closing date, checked
 * together with the questions. Returns the element and `validate()` / `value()` for the form.
 */
export function createBuilder({ fields: initial = [], types, choiceTypes, limits = {}, t, basics = [] }) {
  const CHOICE_TYPES = new Set(choiceTypes);
  const typeIds = new Set(types.map(([type]) => type));
  const tb = (key, params) => t(`client.builder.${key}`, params);

  let fields = initial.map((f) => ({
    id: typeof f.id === 'string' ? f.id : '',
    label: String(f.label ?? ''),
    type: typeIds.has(f.type) ? f.type : 'text',
    required: f.required === true,
    options: Array.isArray(f.options) ? f.options.join('\n') : String(f.options ?? ''),
  }));
  if (!fields.length) fields.push(blank());

  // Icon-only button: the label is exposed to screen readers and as a tooltip.
  const iconButton = (name, label, onClick, { danger = false, disabled = false } = {}) => h('button', {
    type: 'button', class: `icon-button${danger ? ' danger' : ''}`, title: label, 'aria-label': label, disabled, onclick: onClick,
  }, icon(name));

  const list = h('ol', { class: 'field-list' });
  const addButton = h('button', {
    type: 'button',
    class: 'big add-question',
    onclick: () => { fields.push(blank()); render(fields.length - 1); },
  }, icon('plus'), ` ${tb('addQuestion')}`);
  const element = h('div', { id: 'builder' }, list, addButton);

  // Controls and message slots of each rendered question, by index; filled by fieldItem().
  let items = [];
  // After the first blocked submit, missing answers are flagged too, and update while typing.
  let submitted = false;

  /** Problems of each question, by index: { label?: message, options?: message }. */
  function fieldProblems() {
    const problems = fields.map((field) => (submitted ? {
      label: field.label.trim() ? undefined : t('validation.required'),
      options: CHOICE_TYPES.has(field.type) && !optionLines(field.options).length ? tb('optionsRequired') : undefined,
    } : {}));
    const byText = new Map();
    fields.forEach((field, index) => {
      const key = sameTextKey(field.label);
      if (!key) return;
      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(index);
    });
    for (const indexes of byText.values()) {
      if (indexes.length < 2) continue;
      for (const index of indexes) {
        const other = indexes.find((i) => i !== index);
        problems[index].label ??= tb('duplicateQuestion', { n: other + 1 });
      }
    }
    fields.forEach((field, index) => {
      if (!CHOICE_TYPES.has(field.type)) return;
      const seen = new Map();
      for (const option of optionLines(field.options)) {
        const key = sameTextKey(option);
        if (seen.has(key)) {
          problems[index].options ??= tb('duplicateOption', { option: seen.get(key) });
          break;
        }
        seen.set(key, option);
      }
    });
    return problems;
  }

  /** Shows or hides one inline message under a control, with the same markup as the respondent form. */
  function setMessage(control, slot, message) {
    slot.hidden = !message;
    slot.lastChild.textContent = message ?? '';
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', slot.id);
    } else {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
  }

  /** Updates every message (survey basics, then questions); returns the first control with a problem. */
  function refreshMessages() {
    let first;
    for (const basic of basics) {
      const message = submitted ? basic.check() : undefined;
      setMessage(basic.control, basic.slot, message);
      first ??= message ? basic.control : undefined;
    }
    fieldProblems().forEach((problem, index) => {
      const item = items[index];
      if (!item) return;
      setMessage(item.label, item.labelError, problem.label);
      setMessage(item.options, item.optionsError, problem.options);
      first ??= (problem.label && item.label) || (problem.options && item.options) || undefined;
    });
    return first;
  }

  let messageCount = 0;
  const messageSlot = () => {
    messageCount += 1;
    return h('p', { class: 'field-error', id: `builder_error_${messageCount}`, hidden: true }, icon('alert'), h('span'));
  };

  for (const basic of basics) {
    basic.slot = messageSlot();
    basic.control.closest('label').after(basic.slot);
    basic.control.addEventListener('input', () => { if (submitted) refreshMessages(); });
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    render(target);
  }

  function duplicate(index) {
    // The copy gets a new id so its answers are stored separately.
    fields.splice(index + 1, 0, { ...fields[index], id: '' });
    render(index + 1);
  }

  function remove(index) {
    if (fields.length === 1) {
      window.alert(tb('needOneQuestion'));
      return;
    }
    const name = fields[index].label.trim();
    if (name && !window.confirm(tb('deleteConfirm', { name }))) return;
    fields.splice(index, 1);
    render(Math.min(index, fields.length - 1));
  }

  function fieldItem(field, index) {
    const label = h('input', { value: field.label, required: true, maxlength: limits.label ?? 300, placeholder: tb('questionPlaceholder') });
    label.addEventListener('input', () => { field.label = label.value; refreshMessages(); });

    const type = h('select', {}, types.map(([value, text]) => h('option', { value, selected: value === field.type }, text)));

    const required = h('input', { type: 'checkbox', checked: field.required });
    required.addEventListener('change', () => { field.required = required.checked; });

    const options = h('textarea', { rows: 4, placeholder: tb('optionsPlaceholder') });
    options.value = field.options;
    options.addEventListener('input', () => { field.options = options.value; refreshMessages(); });
    const labelError = messageSlot();
    const optionsError = messageSlot();
    const optionsWrap = h('div', { class: 'options', hidden: !CHOICE_TYPES.has(field.type) },
      h('label', {}, `${tb('options')} `, h('span', { class: 'hint' }, tb('optionsHint')), options),
      h('span', { class: 'hint' }, tb('noRepeatedOptions')),
      optionsError);
    items[index] = { label, options, labelError, optionsError };

    type.addEventListener('change', () => {
      field.type = type.value;
      optionsWrap.hidden = !CHOICE_TYPES.has(field.type);
      if (!optionsWrap.hidden && !options.value.trim()) options.focus();
      refreshMessages();
    });

    const toolbar = h('div', { class: 'field-toolbar' },
      h('span', { class: 'field-number' }, tb('questionNumber', { n: index + 1 })),
      h('div', { class: 'icon-group' },
        iconButton('up', tb('moveUp'), () => move(index, -1), { disabled: index === 0 }),
        iconButton('down', tb('moveDown'), () => move(index, 1), { disabled: index === fields.length - 1 }),
        iconButton('duplicate', tb('duplicate'), () => duplicate(index)),
        iconButton('trash', tb('delete'), () => remove(index), { danger: true })));

    return h('li', { class: 'field-item panel' },
      toolbar,
      h('label', {}, tb('question'), label),
      labelError,
      h('div', { class: 'field-settings' },
        h('label', {}, tb('answerType'), type),
        h('label', { class: 'choice switch' }, required, h('span', {}, tb('required')))),
      optionsWrap);
  }

  // Re-render the list; optionally keep the focus on the item that just moved or was added.
  function render(focusIndex) {
    items = [];
    list.replaceChildren(...fields.map(fieldItem));
    refreshMessages();
    if (focusIndex === undefined) return;
    const item = list.children[focusIndex];
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    item?.querySelector('input')?.focus({ preventScroll: true });
  }

  render();

  return {
    element,
    /** Flags every problem; returns the first control with one (undefined when all is valid). */
    validate() {
      submitted = true;
      return refreshMessages();
    },
    /** The questions in the API's shape (existing ones keep their id, so their answers still match). */
    value: () => fields.map((f) => ({
      ...(f.id ? { id: f.id } : {}),
      label: f.label,
      type: f.type,
      required: f.required,
      options: CHOICE_TYPES.has(f.type) ? f.options.split('\n') : [],
    })),
  };
}
