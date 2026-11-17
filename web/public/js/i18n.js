/**
 * Interface translations. Each language lives in web/locales/<code>.json as flat "dot.separated"
 * keys. Values may contain {name} placeholders; plurals use "<key>.one" and "<key>.other".
 */
export const SUPPORTED_LANGUAGES = ['en', 'es'];
export const DEFAULT_LANGUAGE = 'en';

const DATE_LOCALES = { en: 'en-US', es: 'es-ES' };

const isSupported = (code) => typeof code === 'string' && SUPPORTED_LANGUAGES.includes(code);

/**
 * The interface language: a saved choice wins; otherwise the first browser language
 * (navigator.languages, in order) that is supported, ignoring the region ("es-MX" -> "es");
 * otherwise English.
 */
export function pickLanguage(saved, preferred = []) {
  if (isSupported(saved)) return saved;
  for (const tag of preferred ?? []) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (isSupported(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

export const interpolate = (text, params = {}) =>
  String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));

/**
 * Translator for one language. Missing keys fall back to `fallback` (English), then to the key.
 * `t` and `tn` are plain functions, so they can be passed around on their own.
 */
export function createI18n(lang, messages = {}, fallback = {}) {
  const code = isSupported(lang) ? lang : DEFAULT_LANGUAGE;
  const plurals = new Intl.PluralRules(code);
  const dates = new Intl.DateTimeFormat(DATE_LOCALES[code], { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

  const t = (key, params = {}) => interpolate(messages[key] ?? fallback[key] ?? key, params);
  const tn = (key, count, params = {}) => t(`${key}.${plurals.select(count) === 'one' ? 'one' : 'other'}`, { count, ...params });
  /** "2026-11-26" -> "Nov 26, 2026" (en) or "26 nov 2026" (es). */
  const formatDate = (dateString) => (dateString ? dates.format(new Date(`${dateString}T00:00:00Z`)) : '');

  return { lang: code, t, tn, formatDate };
}
