import { readFileSync } from 'node:fs';

/**
 * API-side texts. The API speaks English in error messages (clients translate the error codes);
 * other languages only cover what the API itself writes for people: CSV headers and yes/no labels.
 * Each language lives in api/locales/<code>.json as flat "dot.separated" keys with {name} placeholders.
 */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'pt'];
export const DEFAULT_LANGUAGE = 'en';

const MESSAGES = Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [
  lang,
  JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8')),
]));

export const isSupportedLanguage = (code) => typeof code === 'string' && SUPPORTED_LANGUAGES.includes(code);

/**
 * First supported language of an Accept-Language header by q-value (region ignored: "es-MX" -> "es");
 * "*", an empty header or only unsupported languages give English.
 */
export function negotiateLanguage(acceptLanguage) {
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
    if (isSupportedLanguage(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

const interpolate = (text, params) =>
  text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));

/** Translator for one language. Missing keys fall back to English, then to the key itself. */
export function createI18n(lang = DEFAULT_LANGUAGE) {
  const code = isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  const messages = MESSAGES[code];
  const t = (key, params = {}) => interpolate(messages[key] ?? MESSAGES[DEFAULT_LANGUAGE][key] ?? key, params);
  return { lang: code, t };
}

/** English translator, used as the default wherever no language is given. */
export const defaultI18n = createI18n(DEFAULT_LANGUAGE);
