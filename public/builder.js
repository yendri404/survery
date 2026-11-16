// Question builder for the survey editor. Serializes questions into #fields_json on submit.
(() => {
  const root = document.getElementById('builder');
  const hidden = document.getElementById('fields_json');
  if (!root || !hidden) return;

  const types = JSON.parse(root.dataset.types);
  const CHOICE_TYPES = new Set(['select', 'radio', 'checkbox']);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    up: 'M12 19V5M5 12l7-7 7 7',
    down: 'M12 5v14M19 12l-7 7-7-7',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
    plus: 'M12 5v14M5 12h14',
  };
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
  const addButton = el('button', { type: 'button', className: 'big add-question' }, [svgIcon('plus'), ' Add a question']);
  addButton.addEventListener('click', () => {
    fields.push(blank());
    render(fields.length - 1);
  });
  root.append(list, addButton);

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
      alert('A survey needs at least one question.');
      return;
    }
    const name = fields[index].label.trim();
    if (name && !confirm(`Delete the question "${name}"?`)) return;
    fields.splice(index, 1);
    render(Math.min(index, fields.length - 1));
  }

  function fieldItem(field, index) {
    const label = el('input', { value: field.label, required: true, maxLength: 300, placeholder: 'Write your question here' });
    label.addEventListener('input', () => { field.label = label.value; });

    const type = el('select', {}, Object.entries(types).map(([value, text]) =>
      el('option', { value, textContent: text, selected: value === field.type })));

    const required = el('input', { type: 'checkbox', checked: field.required });
    required.addEventListener('change', () => { field.required = required.checked; });

    const options = el('textarea', { value: field.options, rows: 4, placeholder: 'Write one option per line, for example:\nYes\nNo' });
    options.addEventListener('input', () => { field.options = options.value; });
    const optionsWrap = el('label', { className: 'options' }, [
      'Options ',
      el('span', { className: 'hint', textContent: 'One option per line.' }),
      options,
    ]);
    optionsWrap.hidden = !CHOICE_TYPES.has(field.type);

    type.addEventListener('change', () => {
      field.type = type.value;
      optionsWrap.hidden = !CHOICE_TYPES.has(field.type);
      if (!optionsWrap.hidden && !options.value.trim()) options.focus();
    });

    const toolbar = el('div', { className: 'field-toolbar' }, [
      el('span', { className: 'field-number', textContent: `Question ${index + 1}` }),
      el('div', { className: 'icon-group' }, [
        iconButton('up', 'Move up', () => move(index, -1), { disabled: index === 0 }),
        iconButton('down', 'Move down', () => move(index, 1), { disabled: index === fields.length - 1 }),
        iconButton('copy', 'Duplicate question', () => duplicate(index)),
        iconButton('trash', 'Delete question', () => remove(index), { danger: true }),
      ]),
    ]);

    return el('li', { className: 'field-item panel' }, [
      toolbar,
      el('label', {}, ['Question', label]),
      el('div', { className: 'field-settings' }, [
        el('label', {}, ['Type of answer', type]),
        el('label', { className: 'choice switch' }, [required, el('span', { textContent: 'Answer is required' })]),
      ]),
      optionsWrap,
    ]);
  }

  // Re-render the list; optionally keep the focus on the item that just moved or was added.
  function render(focusIndex) {
    list.replaceChildren(...fields.map(fieldItem));
    if (focusIndex === undefined) return;
    const item = list.children[focusIndex];
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    item?.querySelector('input')?.focus({ preventScroll: true });
  }

  root.closest('form').addEventListener('submit', () => {
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
