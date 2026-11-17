/**
 * Number questions accept only a number: digits, one decimal point and a minus sign at the start.
 * A comma becomes a point ("4,5" -> "4.5") and spaces are dropped. Pure rules, used by the
 * respondent form while typing, pasting or dropping text.
 */
export const NUMBER_TEXT = /^-?\d*\.?\d*$/;

export const normalizeNumberText = (text) => String(text).replace(/,/g, '.').replace(/\s+/g, '');

/**
 * What to do with `data` typed over value[start, end): block it, let the browser insert it, or
 * insert the cleaned `rewrite` instead (when cleaning changed it).
 */
export function numberInsert(value, start, end, data) {
  const text = normalizeNumberText(data);
  const next = value.slice(0, start) + text + value.slice(end);
  if (!NUMBER_TEXT.test(next)) return { allow: false };
  return text === data ? { allow: true } : { allow: true, rewrite: text };
}

/** Up/Down arrows: the value plus `delta`, rounded so 0.1 + 1 shows as 1.1; undefined when not a number. */
export function stepNumber(value, delta) {
  const current = Number(value || 0);
  if (!Number.isFinite(current)) return undefined;
  return String(Number((current + delta).toFixed(10)));
}
