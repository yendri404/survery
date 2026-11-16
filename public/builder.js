// Question builder for the survey editor. Serializes questions into #fields_json on submit.
(() => {
  const root = document.getElementById('builder');
  const hidden = document.getElementById('fields_json');
  if (!root || !hidden) return;

  const types = JSON.parse(root.dataset.types);
  const CHOICE_TYPES = new Set(['select', 'radio', 'checkbox']);
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
  const button = (text, onClick, className = 'secondary') =>
    el('button', { type: 'button', textContent: text, className, onclick: onClick });

  const list = el('ol', { className: 'field-list' });
  root.append(list, button('+ Add question', () => {
    fields.push(blank());
    render();
    list.lastElementChild?.querySelector('input')?.focus();
  }, ''));

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    render();
  }

  function fieldItem(field, index) {
    const label = el('input', { value: field.label, required: true, maxLength: 300, placeholder: 'Question text' });
    label.addEventListener('input', () => { field.label = label.value; });

    const type = el('select', {}, Object.entries(types).map(([value, text]) =>
      el('option', { value, textContent: text, selected: value === field.type })));

    const required = el('input', { type: 'checkbox', checked: field.required });
    required.addEventListener('change', () => { field.required = required.checked; });

    const options = el('textarea', { value: field.options, rows: 4, placeholder: 'One option per line' });
    options.addEventListener('input', () => { field.options = options.value; });
    const optionsWrap = el('label', { className: 'options' }, ['Options (one per line)', options]);
    optionsWrap.hidden = !CHOICE_TYPES.has(field.type);

    type.addEventListener('change', () => {
      field.type = type.value;
      optionsWrap.hidden = !CHOICE_TYPES.has(field.type);
    });

    return el('li', { className: 'field-item' }, [
      el('label', {}, ['Question', label]),
      el('div', { className: 'row' }, [
        el('label', {}, ['Type ', type]),
        el('label', { className: 'choice' }, [required, ' Required']),
      ]),
      optionsWrap,
      el('div', { className: 'row' }, [
        button('Move up', () => move(index, -1)),
        button('Move down', () => move(index, 1)),
        button('Remove', () => {
          if (fields.length === 1) return alert('A survey needs at least one question.');
          fields.splice(index, 1);
          render();
        }, 'danger'),
      ]),
    ]);
  }

  function render() {
    list.replaceChildren(...fields.map(fieldItem));
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
