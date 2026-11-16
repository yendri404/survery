import { readFileSync } from 'node:fs';

/**
 * Interface translations. Each language lives in locales/<code>.json as flat "dot.separated" keys.
 * Values may contain {name} placeholders; plurals use "<key>.one" and "<key>.other".
 * All files are read once at startup.
 */
export const SUPPORTED_LANGUAGES = ['en', 'es'];
export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_COOKIE = 'sharevy_lang';

const DATE_LOCALES = { en: 'en-US', es: 'es-ES' };

const MESSAGES = Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [
  lang,
  JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8')),
]));

const isSupported = (code) => typeof code === 'string' && SUPPORTED_LANGUAGES.includes(code);

/**
 * Picks the interface language: a supported cookie value wins; otherwise the first supported
 * language of the Accept-Language header by q-value (region ignored: "es-MX" -> "es");
 * "*", an empty header or only unsupported languages give English.
 */
export function negotiateLanguage(cookieValue, acceptLanguage) {
  if (isSupported(cookieValue)) return cookieValue;
  const ranges = String(acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...attributes] = part.trim().split(';');
      const q = attributes.map((a) => a.trim()).find((a) => a.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter(({ tag, q }) => tag && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranges) {
    if (tag === '*') return DEFAULT_LANGUAGE;
    const primary = tag.split('-')[0];
    if (isSupported(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

const interpolate = (text, params) =>
  text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));

/**
 * Translator for one language. Missing keys fall back to English, then to the key itself.
 * `t` and `tn` are plain functions, so they can be passed around on their own.
 */
export function createI18n(lang = DEFAULT_LANGUAGE) {
  const code = isSupported(lang) ? lang : DEFAULT_LANGUAGE;
  const messages = MESSAGES[code];
  const plurals = new Intl.PluralRules(code);
  const dates = new Intl.DateTimeFormat(DATE_LOCALES[code], { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

  const t = (key, params = {}) => interpolate(messages[key] ?? MESSAGES[DEFAULT_LANGUAGE][key] ?? key, params);
  const tn = (key, count, params = {}) =>
    t(`${key}.${plurals.select(count) === 'one' ? 'one' : 'other'}`, { count, ...params });
  /** "2026-11-26" -> "Nov 26, 2026" (en) or "26 nov 2026" (es). */
  const formatDate = (dateString) => (dateString ? dates.format(new Date(`${dateString}T00:00:00Z`)) : '');

  return { lang: code, t, tn, formatDate };
}

/** Keys starting with "client." without that prefix: the strings the browser scripts need. */
export function clientMessages(i18n) {
  const prefix = 'client.';
  return Object.fromEntries(Object.keys(MESSAGES[DEFAULT_LANGUAGE])
    .filter((key) => key.startsWith(prefix))
    .map((key) => [key.slice(prefix.length), i18n.t(key)]));
}

/** English translator, used as the default wherever no request language is available. */
export const defaultI18n = createI18n(DEFAULT_LANGUAGE);
