/**
 * Respondent answers, checked in the browser with the same rules and messages as the API
 * (validateAnswers in api/src/surveys.js), so a mistake shows at once. The API checks again.
 * Results are message descriptors `{ key, params }` (web/locales keys), or undefined when valid.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const problem = (key, params = {}) => ({ key, params });
const tooLong = (value, max) => max !== undefined && value.length > max;

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * One question. `value` is the text (radio and yes/no: the checked value, '' when none) or, for
 * checkbox, the list of checked options. `options` are the allowed values of choice questions.
 */
export function checkAnswer({ type, required, value, options = [] }, limits = {}) {
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

/** The optional respondent name (trimmed; empty means anonymous). */
export function checkRespondentName(value, limits = {}) {
  const max = limits.respondentName;
  return tooLong(String(value ?? '').trim(), max) ? problem('validation.respondentNameTooLong', { max }) : undefined;
}
