import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, createI18n, negotiateLanguage } from '../src/i18n.js';

const load = (lang) => JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test('every locale file has exactly the same keys as English', () => {
  const en = load('en');
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(load(lang)).sort(), Object.keys(en).sort(), `${lang}.json keys differ from en.json`);
  }
});

test('every {param} placeholder in English exists in each translation', () => {
  const en = load('en');
  for (const lang of SUPPORTED_LANGUAGES) {
    const other = load(lang);
    for (const [key, text] of Object.entries(en)) {
      for (const name of placeholders(text)) {
        assert.ok(placeholders(other[key] ?? '').has(name), `${lang}.json "${key}" is missing {${name}}`);
      }
    }
  }
});

test('negotiateLanguage prefers the cookie, then Accept-Language, then English', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'es']);
  assert.equal(negotiateLanguage('es', 'en-US,en;q=0.9'), 'es');
  assert.equal(negotiateLanguage('en', 'es-ES'), 'en');
  assert.equal(negotiateLanguage(undefined, 'es-ES,es;q=0.9'), 'es');
  assert.equal(negotiateLanguage(undefined, 'fr, es;q=0.5'), 'es');
  assert.equal(negotiateLanguage(undefined, 'fr;q=0.9, es;q=0.95'), 'es');
  assert.equal(negotiateLanguage(undefined, '*'), 'en');
  assert.equal(negotiateLanguage(undefined, undefined), 'en');
  assert.equal(negotiateLanguage(undefined, 'fr'), 'en');
  assert.equal(negotiateLanguage('fr', 'es'), 'es');
  assert.equal(negotiateLanguage('xx', undefined), 'en');
});

test('createI18n translates, interpolates, pluralizes and falls back to English, then the key', () => {
  const en = createI18n('en');
  const es = createI18n('es');
  assert.equal(en.lang, 'en');
  assert.equal(es.lang, 'es');
  assert.equal(en.t('nav.mySurveys'), 'My surveys');
  assert.equal(es.t('nav.mySurveys'), 'Mis encuestas');
  assert.equal(en.t('validation.titleTooLong', { max: 200 }), 'Title must be at most 200 characters.');
  assert.equal(en.tn('list.responses', 1), '1 response');
  assert.equal(en.tn('list.responses', 3), '3 responses');
  assert.equal(es.tn('list.responses', 1), '1 respuesta');
  assert.equal(es.tn('list.responses', 0), '0 respuestas');
  assert.equal(es.t('no.such.key'), 'no.such.key');
  assert.equal(createI18n('fr').lang, 'en');
});

test('formatDate keeps the English format and uses the Spanish one in Spanish', () => {
  assert.equal(createI18n('en').formatDate('2026-11-26'), 'Nov 26, 2026');
  assert.equal(createI18n('es').formatDate('2026-11-26'), '26 nov 2026');
  assert.equal(createI18n('en').formatDate(''), '');
});
