import { randomBytes } from 'node:crypto';
import { defaultI18n } from './i18n.js';

// User-facing messages come from a translator `t` passed in by the caller; English by default.
const englishT = defaultI18n.t;

/** Question types, in the order editors offer them. Clients name them in their own language. */
export const FIELD_TYPE_IDS = ['text', 'textarea', 'number', 'scale', 'email', 'date', 'select', 'radio', 'yesno', 'checkbox'];

/** Types whose options the creator writes. */
export const CHOICE_TYPES = new Set(['select', 'radio', 'checkbox']);

/**
 * Stored values of a yes/no question. They never depend on the language: the respondent form,
 * the results and the CSV show them translated ("answer.yes" / "answer.no").
 */
export const YES_NO = ['yes', 'no'];

/** The values a single or multiple choice question accepts; yes/no has fixed ones. */
const fieldOptions = (field) => (field.type === 'yesno' ? YES_NO : field.options);

/** Text shown for an answer: yes/no in the reader's language, arrays as "a, b". */
export function answerText(field, value, t = englishT) {
  if (field.type === 'yesno' && YES_NO.includes(value)) return t(`answer.${value}`);
  return formatAnswer(value);
}

export const LIMITS = {
  title: 200,
  description: 2000,
  label: 300,
  fields: 100,
  options: 100,
  option: 200,
  text: 1000,
  textarea: 10000,
  respondentName: 100,
};

/**
 * Scale (slider) questions: whole numbers from `min` to `max`, in steps of 1. The creator picks the
 * range; it defaults to 1-10, both ends stay within lowest..highest and at most maxSteps apart.
 */
export const SCALE = { defaultMin: 1, defaultMax: 10, lowest: -1000, highest: 1000, maxSteps: 100 };

const WHOLE_NUMBER = /^-?\d+$/;

/** A whole number written as a number or as text ("3", " -2 "); undefined otherwise. */
function wholeNumber(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === 'string' && WHOLE_NUMBER.test(value.trim())) return Number(value.trim());
  return undefined;
}

/** The range of a scale question; a missing end (undefined, null or '') takes its default. */
function parseScaleRange(input, n, t) {
  const read = (value, fallback) => (value === undefined || value === null || value === '' ? fallback : wholeNumber(value));
  const min = read(input.min, SCALE.defaultMin);
  const max = read(input.max, SCALE.defaultMax);
  const inBounds = (v) => v !== undefined && v >= SCALE.lowest && v <= SCALE.highest;
  if (!inBounds(min) || !inBounds(max)) {
    return { error: t('validation.scaleBoundInvalid', { n, lowest: SCALE.lowest, highest: SCALE.highest }) };
  }
  if (min >= max) return { error: t('validation.scaleOrder', { n }) };
  if (max - min > SCALE.maxSteps) return { error: t('validation.scaleTooWide', { n, maxSteps: SCALE.maxSteps }) };
  return { min, max };
}

/** Days a survey stays open when the creator does not pick a closing date. */
export const DEFAULT_OPEN_DAYS = 10;

/** Calendar date (YYYY-MM-DD) in the server's local time zone. */
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Adds whole days to a YYYY-MM-DD date (pure calendar math, no time zone involved). */
export function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from one YYYY-MM-DD date to another ("2026-11-16" -> "2026-11-26" = 10). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * 'open' accepts answers; 'closed' was closed by the creator; 'expired' passed its closing date.
 * A survey accepts answers during the whole closing day. YYYY-MM-DD strings compare correctly as text.
 */
export function surveyStatus(survey, today) {
  if (!survey.isOpen) return 'closed';
  return survey.closesOn && today > survey.closesOn ? 'expired' : 'open';
}

/**
 * The name a respondent leaves. Empty means anonymous, unless the survey requires the name
 * (`required`: the survey's requireName setting).
 */
export function parseRespondentName(value, { required = false, t = englishT } = {}) {
  const name = String(value ?? '').trim();
  if (required && !name) return { name, error: t('validation.respondentNameRequired') };
  if (name.length > LIMITS.respondentName) {
    return { name, error: t('validation.respondentNameTooLong', { max: LIMITS.respondentName }) };
  }
  return { name, error: undefined };
}

const FIELD_ID = /^[a-z0-9]{4,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email address as creators register with and email questions accept (at most 254 characters). */
export const isEmail = (value) => value.length <= 254 && EMAIL.test(value);

function newFieldId(taken) {
  let id;
  do id = randomBytes(6).toString('hex');
  while (taken.has(id));
  return id;
}

/**
 * Validates and normalizes the survey definition sent by the editor.
 * Field ids are preserved when valid so existing answers keep matching after an edit.
 *
 * The closing date defaults to DEFAULT_OPEN_DAYS from `today` when empty. A past date is rejected,
 * except when it is the survey's current date (editing an expired survey without changing it).
 *
 * `requireName` (must respondents write their name?) is true or false; left out (undefined) it keeps
 * `currentRequireName`, which is false for a new survey.
 */
export function parseSurveyInput(
  { title, description, fieldsJson, closesOn, requireName },
  { today = localDateString(), currentClosesOn, currentRequireName = false, t = englishT } = {},
) {
  const errors = [];
  const cleanTitle = String(title ?? '').trim();
  const cleanDescription = String(description ?? '').trim();
  const cleanClosesOn = String(closesOn ?? '').trim() || addDays(today, DEFAULT_OPEN_DAYS);

  if (!cleanTitle) errors.push(t('validation.titleRequired'));
  else if (cleanTitle.length > LIMITS.title) errors.push(t('validation.titleTooLong', { max: LIMITS.title }));
  if (cleanDescription.length > LIMITS.description) {
    errors.push(t('validation.descriptionTooLong', { max: LIMITS.description }));
  }
  if (!isValidDate(cleanClosesOn)) errors.push(t('validation.closingDateInvalid'));
  else if (cleanClosesOn < today && cleanClosesOn !== currentClosesOn) errors.push(t('validation.closingDatePast'));
  const cleanRequireName = requireName === undefined ? currentRequireName : requireName;
  if (typeof cleanRequireName !== 'boolean') errors.push(t('validation.requireNameInvalid'));

  let raw;
  try {
    raw = JSON.parse(fieldsJson || '[]');
  } catch {
    raw = null;
  }

  const fields = [];
  const duplicateQuestionErrors = []; // reported after the per-question errors
  if (!Array.isArray(raw)) {
    errors.push(t('validation.fieldsInvalid'));
  } else {
    if (raw.length === 0) errors.push(t('validation.fieldsEmpty'));
    if (raw.length > LIMITS.fields) errors.push(t('validation.fieldsTooMany', { max: LIMITS.fields }));

    const ids = new Set();
    const questionNumbers = new Map(); // comparison key of a question text -> its 1-based number
    raw.slice(0, LIMITS.fields).forEach((input, index) => {
      const n = index + 1;
      if (!input || typeof input !== 'object') {
        errors.push(t('validation.fieldInvalid', { n }));
        return;
      }
      const label = String(input.label ?? '').trim();
      const type = String(input.type ?? '');

      if (!label) errors.push(t('validation.labelRequired', { n }));
      else if (label.length > LIMITS.label) errors.push(t('validation.labelTooLong', { n, max: LIMITS.label }));
      if (label) {
        const first = questionNumbers.get(sameTextKey(label));
        if (first) duplicateQuestionErrors.push(t('validation.labelDuplicate', { first, second: n }));
        else questionNumbers.set(sameTextKey(label), n);
      }
      if (!FIELD_TYPE_IDS.includes(type)) errors.push(t('validation.typeUnknown', { n }));

      const id = typeof input.id === 'string' && FIELD_ID.test(input.id) && !ids.has(input.id)
        ? input.id
        : newFieldId(ids);
      ids.add(id);

      let options = [];
      if (CHOICE_TYPES.has(type)) {
        const rawOptions = Array.isArray(input.options) ? input.options : String(input.options ?? '').split('\n');
        options = rawOptions.map((o) => String(o).trim()).filter(Boolean);
        for (const option of repeatedTexts(options)) errors.push(t('validation.optionDuplicate', { n, option }));
        if (options.length === 0) errors.push(t('validation.optionsEmpty', { n }));
        if (options.length > LIMITS.options) errors.push(t('validation.optionsTooMany', { n, max: LIMITS.options }));
        if (options.some((o) => o.length > LIMITS.option)) {
          errors.push(t('validation.optionTooLong', { n, max: LIMITS.option }));
        }
      }

      const field = { id, label, type, required: input.required === true, options };
      // Only scale questions carry min/max; other types drop them.
      if (type === 'scale') {
        const range = parseScaleRange(input, n, t);
        if (range.error) errors.push(range.error);
        else Object.assign(field, { min: range.min, max: range.max });
      }
      fields.push(field);
    });
    errors.push(...duplicateQuestionErrors);
  }

  return {
    value: { title: cleanTitle, description: cleanDescription, closesOn: cleanClosesOn, requireName: cleanRequireName === true, fields },
    errors,
  };
}

/**
 * Two texts count as the same question or option when they match after trimming, ignoring case.
 * The web client applies the same rule while the creator types.
 */
const sameTextKey = (text) => text.trim().toLocaleLowerCase();

/** Each text that appears more than once (by sameTextKey), as first written, in order. */
function repeatedTexts(texts) {
  const seen = new Map();
  const repeated = new Set();
  for (const text of texts) {
    const key = sameTextKey(text);
    if (seen.has(key)) repeated.add(seen.get(key));
    else seen.set(key, text);
  }
  return [...repeated];
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates a respondent submission. `form` reads values by name (URLSearchParams-like: get/getAll);
 * each answer is named `f_<fieldId>`.
 * Returns the normalized answers and a map of fieldId -> error message.
 */
export function validateAnswers(fields, form, { t = englishT } = {}) {
  const answers = {};
  const errors = {};

  for (const field of fields) {
    const name = `f_${field.id}`;

    if (field.type === 'checkbox') {
      const selected = form.getAll(name);
      if (selected.some((v) => !field.options.includes(v))) errors[field.id] = t('validation.invalidOption');
      const values = field.options.filter((o) => selected.includes(o));
      if (field.required && values.length === 0 && !errors[field.id]) errors[field.id] = t('validation.required');
      answers[field.id] = values;
      continue;
    }

    const value = String(form.get(name) ?? '').trim();
    answers[field.id] = value;
    if (!value) {
      if (field.required) errors[field.id] = t('validation.required');
      continue;
    }

    switch (field.type) {
      case 'text':
        if (value.length > LIMITS.text) errors[field.id] = t('validation.tooLong', { max: LIMITS.text });
        break;
      case 'textarea':
        if (value.length > LIMITS.textarea) errors[field.id] = t('validation.tooLong', { max: LIMITS.textarea });
        break;
      case 'number':
        if (!Number.isFinite(Number(value))) errors[field.id] = t('validation.number');
        break;
      case 'scale': {
        // Stored as text like number answers, written the usual way ("04" -> "4").
        const n = WHOLE_NUMBER.test(value) ? Number(value) : NaN;
        if (n >= field.min && n <= field.max) answers[field.id] = String(n);
        else errors[field.id] = t('validation.scaleRange', { min: field.min, max: field.max });
        break;
      }
      case 'email':
        if (!isEmail(value)) errors[field.id] = t('validation.email');
        break;
      case 'date':
        if (!isValidDate(value)) errors[field.id] = t('validation.date');
        break;
      case 'select':
      case 'radio':
      case 'yesno':
        if (!fieldOptions(field).includes(value)) errors[field.id] = t('validation.invalidOption');
        break;
    }
  }

  return { answers, errors };
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value == null ? '' : String(value);
}

/**
 * Per-option counts for choice fields (yes/no included). Each count carries the stored `option`
 * and the `label` to show, in the translator's language for yes/no.
 *
 * Scale questions count every whole number from min to max (zeros included) and add `scale`:
 * the range, the average (1 decimal) and the median of the answers, or null without answers.
 * Answers left outside the range by a later range change count in `answered`, the average and the
 * median, but have no bar: `outOfRange` says how many.
 */
export function summarize(fields, responses, { t = englishT } = {}) {
  return fields
    .filter((f) => CHOICE_TYPES.has(f.type) || f.type === 'yesno' || f.type === 'scale')
    .map((field) => (field.type === 'scale' ? summarizeScale(field, responses) : summarizeChoices(field, responses, t)));
}

function summarizeChoices(field, responses, t) {
  const counts = new Map(fieldOptions(field).map((o) => [o, 0]));
  let answered = 0;
  for (const { answers } of responses) {
    const value = answers[field.id];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    if (values.length) answered += 1;
    for (const v of values) if (counts.has(v)) counts.set(v, counts.get(v) + 1);
  }
  return {
    field,
    answered,
    counts: [...counts.entries()].map(([option, count]) => ({ option, label: answerText(field, option, t), count })),
  };
}

function summarizeScale(field, responses) {
  const { min, max } = field;
  const counts = new Map();
  for (let v = min; v <= max; v += 1) counts.set(v, 0);
  const values = [];
  for (const { answers } of responses) {
    const text = String(answers[field.id] ?? '').trim();
    if (!WHOLE_NUMBER.test(text)) continue;
    const v = Number(text);
    values.push(v);
    if (counts.has(v)) counts.set(v, counts.get(v) + 1);
  }
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = !values.length ? null : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const average = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
  const drawn = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    field,
    answered: values.length,
    counts: [...counts.entries()].map(([v, count]) => ({ option: String(v), label: String(v), count })),
    scale: { min, max, average, median, outOfRange: values.length - drawn },
  };
}

/** Escapes a CSV cell and neutralizes spreadsheet formula injection. */
export function csvCell(value, delimiter = ',') {
  let s = formatAnswer(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (s.includes(delimiter) || /["\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * A survey title usable as a file name on any system: characters Windows, macOS or Linux refuse
 * (\ / : * ? " < > | and control characters) are dropped, spaces collapsed, at most 100 characters.
 * `fallback` when nothing usable is left.
 */
export function fileSafeName(title, fallback) {
  const name = String(title ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return name || fallback;
}

/**
 * CSV delimiter chosen from the answers: ";" when some number answer has decimals (spreadsheets set
 * to a comma decimal separator then read the columns right), "," otherwise.
 */
export function csvDelimiterFor(fields, responses) {
  const numberIds = fields.filter((f) => f.type === 'number').map((f) => f.id);
  const hasDecimals = responses.some((r) => numberIds.some((id) => {
    const value = Number(r.answers[id]);
    return r.answers[id] !== undefined && r.answers[id] !== '' && Number.isFinite(value) && !Number.isInteger(value);
  }));
  return hasDecimals ? ';' : ',';
}

/** True for an IANA time zone name the runtime knows ("America/Caracas", "UTC"). */
export function isTimeZone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A stored UTC time ("YYYY-MM-DD HH:MM:SS") as the same format in `timeZone`. */
function inTimeZone(utc, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(`${utc.replace(' ', 'T')}Z`));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Responses as CSV. Submission times are UTC unless `timeZone` (IANA name) is given; then they are
 * shown in that zone and the header names it.
 */
export function toCsv(fields, responses, delimiter = ',', { t = englishT, timeZone } = {}) {
  const sentHeader = timeZone ? t('csv.submittedAtZone', { zone: timeZone }) : t('csv.submittedAt');
  const sent = (utc) => (timeZone ? inTimeZone(utc, timeZone) : utc);
  const header = [t('csv.responseNumber'), sentHeader, t('csv.name'), ...fields.map((f) => f.label)];
  const rows = responses
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((r) => [r.number, sent(r.submittedAt), r.respondentName ?? '', ...fields.map((f) => answerText(f, r.answers[f.id], t))]);
  return [header, ...rows].map((row) => row.map((c) => csvCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
