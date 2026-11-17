/**
 * Respondent answers, checked in the browser with the same rules and messages as the API
 * (validateAnswers in api/src/surveys.js), so a mistake shows at once. The API checks again.
 * Results are message descriptors `{ key, params }` (web/locales keys), or undefined when valid.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WHOLE_NUMBER = /^-?\d+$/;

const problem = (key, params = {}) => ({ key, params });
const tooLong = (value, max) => max !== undefined && value.length > max;

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * One question. `value` is the text (radio and yes/no: the checked value, '' when none) or, for
 * checkbox, the list of checked options. `options` are the allowed values of choice questions;
 * `min` / `max` the range of scale questions (an untouched slider sends '').
 */
export function checkAnswer({ type, required, value, options = [], min, max }, limits = {}) {
  if (type === 'checkbox') return required && !value.length ? problem('validation.required') : undefined;
  const text = String(value ?? '').trim();
  if (!text) return required ? problem('validation.required') : undefined;
  switch (type) {
    case 'text':
      return tooLong(text, limits.text) ? problem('validation.tooLong', { max: limits.text }) : undefined;
    case 'textarea':
      return tooLong(text, limits.textarea) ? problem('validation.tooLong', { max: limits.textarea }) : undefined;
    case 'number':
      return Number.isFinite(Number(text)) ? undefined : problem('validation.number');
    case 'scale': {
      const n = WHOLE_NUMBER.test(text) ? Number(text) : NaN;
      return n >= min && n <= max ? undefined : problem('validation.scaleRange', { min, max });
    }
    case 'email':
      return text.length > 254 || !EMAIL.test(text) ? problem('validation.email') : undefined;
    case 'date':
      return isValidDate(text) ? undefined : problem('validation.date');
    case 'yesno':
      return ['yes', 'no'].includes(text) ? undefined : problem('validation.invalidOption');
    case 'select':
    case 'radio':
      return options.includes(text) ? undefined : problem('validation.invalidOption');
    default:
      return undefined;
  }
}

/**
 * The range of a scale question in the builder, with the API's rules (`rules` is /meta's `scale`):
 * whole numbers within lowest..highest, "from" below "to", at most maxSteps apart. Descriptors use
 * the builder's own keys (client.builder.*); undefined when valid.
 */
export function checkScaleRange(min, max, rules) {
  const whole = (v) => (WHOLE_NUMBER.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
  const from = whole(min);
  const to = whole(max);
  const inBounds = (n) => n >= rules.lowest && n <= rules.highest;
  if (!inBounds(from) || !inBounds(to)) {
    return problem('client.builder.scaleBoundInvalid', { lowest: rules.lowest, highest: rules.highest });
  }
  if (from >= to) return problem('client.builder.scaleOrder');
  if (to - from > rules.maxSteps) return problem('client.builder.scaleTooWide', { maxSteps: rules.maxSteps });
  return undefined;
}

/**
 * The respondent name (trimmed). Empty means anonymous, unless the survey requires the name
 * (`required`: the survey's requireName), like parseRespondentName.
 */
export function checkRespondentName(value, limits = {}, { required = false } = {}) {
  const name = String(value ?? '').trim();
  if (required && !name) return problem('validation.respondentNameRequired');
  const max = limits.respondentName;
  return tooLong(name, max) ? problem('validation.respondentNameTooLong', { max }) : undefined;
}
