import { randomBytes } from 'node:crypto';

export const FIELD_TYPES = {
  text: 'Short answer',
  textarea: 'Paragraph (long answer)',
  number: 'Number',
  email: 'Email address',
  date: 'Date',
  select: 'Dropdown list',
  radio: 'Choose one option',
  checkbox: 'Choose several options',
};

export const CHOICE_TYPES = new Set(['select', 'radio', 'checkbox']);

export const LIMITS = {
  title: 200,
  description: 2000,
  label: 300,
  fields: 100,
  options: 100,
  option: 200,
  text: 1000,
  textarea: 10000,
};

const FIELD_ID = /^[a-z0-9]{4,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newFieldId(taken) {
  let id;
  do id = randomBytes(6).toString('hex');
  while (taken.has(id));
  return id;
}

/**
 * Validates and normalizes the survey definition sent by the editor.
 * Field ids are preserved when valid so existing answers keep matching after an edit.
 */
export function parseSurveyInput({ title, description, fieldsJson }) {
  const errors = [];
  const cleanTitle = String(title ?? '').trim();
  const cleanDescription = String(description ?? '').trim();

  if (!cleanTitle) errors.push('Title is required.');
  else if (cleanTitle.length > LIMITS.title) errors.push(`Title must be at most ${LIMITS.title} characters.`);
  if (cleanDescription.length > LIMITS.description) {
    errors.push(`Description must be at most ${LIMITS.description} characters.`);
  }

  let raw;
  try {
    raw = JSON.parse(fieldsJson || '[]');
  } catch {
    raw = null;
  }

  const fields = [];
  if (!Array.isArray(raw)) {
    errors.push('Fields data is invalid.');
  } else {
    if (raw.length === 0) errors.push('Add at least one field.');
    if (raw.length > LIMITS.fields) errors.push(`A survey can have at most ${LIMITS.fields} fields.`);

    const ids = new Set();
    raw.slice(0, LIMITS.fields).forEach((input, index) => {
      const n = index + 1;
      if (!input || typeof input !== 'object') {
        errors.push(`Field ${n} is invalid.`);
        return;
      }
      const label = String(input.label ?? '').trim();
      const type = String(input.type ?? '');

      if (!label) errors.push(`Field ${n}: question text is required.`);
      else if (label.length > LIMITS.label) errors.push(`Field ${n}: question text must be at most ${LIMITS.label} characters.`);
      if (!Object.hasOwn(FIELD_TYPES, type)) errors.push(`Field ${n}: unknown field type.`);

      const id = typeof input.id === 'string' && FIELD_ID.test(input.id) && !ids.has(input.id)
        ? input.id
        : newFieldId(ids);
      ids.add(id);

      let options = [];
      if (CHOICE_TYPES.has(type)) {
        const rawOptions = Array.isArray(input.options) ? input.options : String(input.options ?? '').split('\n');
        options = [...new Set(rawOptions.map((o) => String(o).trim()).filter(Boolean))];
        if (options.length === 0) errors.push(`Field ${n}: add at least one option.`);
        if (options.length > LIMITS.options) errors.push(`Field ${n}: at most ${LIMITS.options} options.`);
        if (options.some((o) => o.length > LIMITS.option)) {
          errors.push(`Field ${n}: each option must be at most ${LIMITS.option} characters.`);
        }
      }

      fields.push({ id, label, type, required: input.required === true, options });
    });
  }

  return { value: { title: cleanTitle, description: cleanDescription, fields }, errors };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates a respondent submission. Form inputs are named `f_<fieldId>`.
 * Returns the normalized answers and a map of fieldId -> error message.
 */
export function validateAnswers(fields, form) {
  const answers = {};
  const errors = {};

  for (const field of fields) {
    const name = `f_${field.id}`;

    if (field.type === 'checkbox') {
      const selected = form.getAll(name);
      if (selected.some((v) => !field.options.includes(v))) errors[field.id] = 'Invalid option selected.';
      const values = field.options.filter((o) => selected.includes(o));
      if (field.required && values.length === 0 && !errors[field.id]) errors[field.id] = 'This field is required.';
      answers[field.id] = values;
      continue;
    }

    const value = String(form.get(name) ?? '').trim();
    answers[field.id] = value;
    if (!value) {
      if (field.required) errors[field.id] = 'This field is required.';
      continue;
    }

    switch (field.type) {
      case 'text':
        if (value.length > LIMITS.text) errors[field.id] = `At most ${LIMITS.text} characters.`;
        break;
      case 'textarea':
        if (value.length > LIMITS.textarea) errors[field.id] = `At most ${LIMITS.textarea} characters.`;
        break;
      case 'number':
        if (!Number.isFinite(Number(value))) errors[field.id] = 'Enter a valid number.';
        break;
      case 'email':
        if (value.length > 254 || !EMAIL.test(value)) errors[field.id] = 'Enter a valid email address.';
        break;
      case 'date':
        if (!isValidDate(value)) errors[field.id] = 'Enter a valid date (YYYY-MM-DD).';
        break;
      case 'select':
      case 'radio':
        if (!field.options.includes(value)) errors[field.id] = 'Invalid option selected.';
        break;
    }
  }

  return { answers, errors };
}

export function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value == null ? '' : String(value);
}

/** Per-option counts for choice fields. */
export function summarize(fields, responses) {
  return fields
    .filter((f) => CHOICE_TYPES.has(f.type))
    .map((field) => {
      const counts = new Map(field.options.map((o) => [o, 0]));
      let answered = 0;
      for (const { answers } of responses) {
        const value = answers[field.id];
        const values = Array.isArray(value) ? value : value ? [value] : [];
        if (values.length) answered += 1;
        for (const v of values) if (counts.has(v)) counts.set(v, counts.get(v) + 1);
      }
      return { field, answered, counts: [...counts.entries()].map(([option, count]) => ({ option, count })) };
    });
}

/** Escapes a CSV cell and neutralizes spreadsheet formula injection. */
export function csvCell(value, delimiter = ',') {
  let s = formatAnswer(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (s.includes(delimiter) || /["\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(fields, responses, delimiter = ',') {
  const header = ['Response ID', 'Submitted at (UTC)', ...fields.map((f) => f.label)];
  const rows = responses
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((r) => [r.id, r.submittedAt, ...fields.map((f) => r.answers[f.id])]);
  return [header, ...rows].map((row) => row.map((c) => csvCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
