// Question builder for the survey editor. Serializes questions into #fields_json on submit.
(() => {
  const root = document.getElementById('builder');
  const hidden = document.getElementById('fields_json');
  if (!root || !hidden) return;

  const types = JSON.parse(root.dataset.types);
  // Interface strings from the server's JSON data block; {name} placeholders are filled in here.
  let messages = {};
  try {
    messages = JSON.parse(document.getElementById('i18n-client')?.textContent || '{}');
  } catch {
    // Missing strings show their keys; the builder keeps working.
  }
  const fill = (text, params) =>
    text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
  const t = (key, params = {}) => fill(messages[`builder.${key}`] ?? key, params);
  // Server validation messages ("validation.*"), shared through the same data block.
  const tv = (key, params = {}) => fill(messages[key] ?? key, params);
  const CHOICE_TYPES = new Set(['select', 'radio', 'checkbox']);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    up: 'M12 19V5M5 12l7-7 7 7',
    down: 'M12 5v14M19 12l-7 7-7-7',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
    plus: 'M12 5v14M5 12h14',
    alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  };
  // Same rule as the server (src/surveys.js): equal after trimming, ignoring case.
  const sameTextKey = (text) => text.trim().toLocaleLowerCase();
  const optionLines = (text) => text.split('\n').map((o) => o.trim()).filter(Boolean);
  const blank = () => ({ id: '', label: '', type: 'text', required: false, options: '' });

  let fields;
  try {
    fields = JSON.parse(hidden.value || '[]');
    if (!Array.isArray(fields)) fields = [];
  } catch {
    fields = [];
  }
  fields = fields.map((f) => ({
    id: typeof f.id === 'string' ? f.id : '',
    label: String(f.label ?? ''),
    type: Object.hasOwn(types, f.type) ? f.type : 'text',
    required: f.required === true,
    options: Array.isArray(f.options) ? f.options.join('\n') : String(f.options ?? ''),
  }));
  if (fields.length === 0) fields.push(blank());

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  function svgIcon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  // Icon-only button: the label is exposed to screen readers and as a tooltip.
  function iconButton(name, label, onClick, { danger = false, disabled = false } = {}) {
    const btn = el('button', {
      type: 'button',
      className: `icon-button${danger ? ' danger' : ''}`,
      title: label,
      disabled,
      onclick: onClick,
    }, [svgIcon(name)]);
    btn.setAttribute('aria-label', label);
    return btn;
  }

  const list = el('ol', { className: 'field-list' });
  const addButton = el('button', { type: 'button', className: 'big add-question' }, [svgIcon('plus'), ` ${t('addQuestion')}`]);
  addButton.addEventListener('click', () => {
    fields.push(blank());
    render(fields.length - 1);
  });
  root.append(list, addButton);

  // Controls and message slots of each rendered question, by index; filled by fieldItem().
  let items = [];

  // After the first blocked submit, missing answers are flagged too, and update while typing.
  let submitted = false;

  /**
   * Problems of each question, by index: { label?: message, options?: message }.
   * Repeated questions and repeated options are flagged while the creator types; empty question
   * text and missing options only after a submit attempt. The server applies the same rules.
   */
  function fieldProblems() {
    const problems = fields.map((field) => (submitted ? {
      label: field.label.trim() ? undefined : tv('validation.required'),
      options: CHOICE_TYPES.has(field.type) && !optionLines(field.options).length ? t('optionsRequired') : undefined,
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
        problems[index].label ??= t('duplicateQuestion', { n: other + 1 });
      }
    }
    fields.forEach((field, index) => {
      if (!CHOICE_TYPES.has(field.type)) return;
      const seen = new Map();
      for (const option of optionLines(field.options)) {
        const key = sameTextKey(option);
        if (seen.has(key)) {
          problems[index].options ??= t('duplicateOption', { option: seen.get(key) });
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
    const slot = el('p', { className: 'field-error', id: `builder_error_${messageCount}` }, [svgIcon('alert'), el('span')]);
    slot.hidden = true;
    return slot;
  };

  // Title and closing date: checked on submit like the questions, with the server's messages.
  const form = root.closest('form');
  const title = form.querySelector('[name="title"]');
  const closesOn = form.querySelector('[name="closes_on"]');
  const basics = [
    title && { control: title, check: () => (title.value.trim() ? undefined : tv('validation.titleRequired')) },
    closesOn && {
      control: closesOn,
      check: () => {
        if (closesOn.validity.badInput) return tv('validation.closingDateInvalid');
        if (!closesOn.value) return tv('validation.required');
        // YYYY-MM-DD strings compare correctly as text; min is today (or the current expired date).
        return closesOn.min && closesOn.value < closesOn.min ? tv('validation.closingDatePast') : undefined;
      },
    },
  ].filter(Boolean);
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
      alert(t('needOneQuestion'));
      return;
    }
    const name = fields[index].label.trim();
    if (name && !confirm(t('deleteConfirm', { name }))) return;
    fields.splice(index, 1);
    render(Math.min(index, fields.length - 1));
  }

  function fieldItem(field, index) {
    const label = el('input', { value: field.label, required: true, maxLength: 300, placeholder: t('questionPlaceholder') });
    label.addEventListener('input', () => { field.label = label.value; refreshMessages(); });

    const type = el('select', {}, Object.entries(types).map(([value, text]) =>
      el('option', { value, textContent: text, selected: value === field.type })));

    const required = el('input', { type: 'checkbox', checked: field.required });
    required.addEventListener('change', () => { field.required = required.checked; });

    const options = el('textarea', { value: field.options, rows: 4, placeholder: t('optionsPlaceholder') });
    options.addEventListener('input', () => { field.options = options.value; refreshMessages(); });
    const labelError = messageSlot();
    const optionsError = messageSlot();
    const optionsWrap = el('div', { className: 'options' }, [
      el('label', {}, [
        `${t('options')} `,
        el('span', { className: 'hint', textContent: t('optionsHint') }),
        options,
      ]),
      el('span', { className: 'hint', textContent: t('noRepeatedOptions') }),
      optionsError,
    ]);
    items[index] = { label, options, labelError, optionsError };
    optionsWrap.hidden = !CHOICE_TYPES.has(field.type);

    type.addEventListener('change', () => {
      field.type = type.value;
      optionsWrap.hidden = !CHOICE_TYPES.has(field.type);
      if (!optionsWrap.hidden && !options.value.trim()) options.focus();
      refreshMessages();
    });

    const toolbar = el('div', { className: 'field-toolbar' }, [
      el('span', { className: 'field-number', textContent: t('questionNumber', { n: index + 1 }) }),
      el('div', { className: 'icon-group' }, [
        iconButton('up', t('moveUp'), () => move(index, -1), { disabled: index === 0 }),
        iconButton('down', t('moveDown'), () => move(index, 1), { disabled: index === fields.length - 1 }),
        iconButton('copy', t('duplicate'), () => duplicate(index)),
        iconButton('trash', t('delete'), () => remove(index), { danger: true }),
      ]),
    ]);

    return el('li', { className: 'field-item panel' }, [
      toolbar,
      el('label', {}, [t('question'), label]),
      labelError,
      el('div', { className: 'field-settings' }, [
        el('label', {}, [t('answerType'), type]),
        el('label', { className: 'choice switch' }, [required, el('span', { textContent: t('required') })]),
      ]),
      optionsWrap,
    ]);
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

  // Inline messages replace the browser's bubbles; the server checks everything again.
  form.noValidate = true;
  form.addEventListener('submit', (event) => {
    // Stopping here keeps what was typed on screen and saves a round trip to the server.
    submitted = true;
    const invalid = refreshMessages();
    if (invalid) {
      event.preventDefault();
      invalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
      invalid.focus({ preventScroll: true });
      return;
    }
    hidden.value = JSON.stringify(fields.map((f) => ({
      id: f.id || undefined,
      label: f.label,
      type: f.type,
      required: f.required,
      options: CHOICE_TYPES.has(f.type) ? f.options.split('\n') : [],
    })));
  });

  render();
})();
