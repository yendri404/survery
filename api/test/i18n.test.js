import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ERROR_CODES } from '../src/errors.js';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, createI18n, negotiateLanguage } from '../src/i18n.js';

const load = (lang) => JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test('every language translates all CSV headers and yes/no labels, and nothing English lacks', () => {
  const en = load('en');
  const translated = Object.keys(en).filter((k) => k.startsWith('csv.') || k.startsWith('answer.'));
  for (const lang of SUPPORTED_LANGUAGES) {
    const keys = Object.keys(load(lang));
    for (const key of translated) assert.ok(keys.includes(key), `${lang}.json lacks ${key}`);
    for (const key of keys) assert.ok(Object.hasOwn(en, key), `${lang}.json has ${key}, unknown in English`);
  }
});

test('every English message maps to a stable snake_case error code, and every code has a message', () => {
  const en = load('en');
  for (const key of Object.keys(en).filter((k) => !k.startsWith('csv.') && !k.startsWith('answer.'))) {
    assert.match(ERROR_CODES[key] ?? '', /^[a-z]+(_[a-z]+)*$/, `${key} has no code`);
  }
  for (const key of Object.keys(ERROR_CODES)) assert.ok(Object.hasOwn(en, key), `${key} has no English message`);
});

test('every {param} placeholder in English exists in each translation', () => {
  const en = load('en');
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const [key, text] of Object.entries(load(lang))) {
      assert.deepEqual(placeholders(text), placeholders(en[key]), `${lang}.json "${key}"`);
    }
  }
});

test('negotiateLanguage reads Accept-Language, then falls back to English', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'es', 'pt']);
  assert.equal(negotiateLanguage('pt-BR,pt;q=0.9,en;q=0.5'), 'pt');
  assert.equal(negotiateLanguage('es-ES,es;q=0.9'), 'es');
  assert.equal(negotiateLanguage('fr, es;q=0.5'), 'es');
  assert.equal(negotiateLanguage('fr;q=0.9, es;q=0.95'), 'es');
  assert.equal(negotiateLanguage('*'), 'en');
  assert.equal(negotiateLanguage(undefined), 'en');
  assert.equal(negotiateLanguage('fr'), 'en');
});

test('createI18n translates, interpolates and falls back to English, then the key', () => {
  assert.equal(createI18n('es').t('answer.yes'), 'Sí');
  assert.equal(createI18n('pt').t('answer.yes'), 'Sim');
  assert.equal(createI18n('pt').t('answer.no'), 'Não');
  assert.equal(createI18n('en').t('validation.titleTooLong', { max: 200 }), 'Title must be at most 200 characters.');
  assert.equal(createI18n('es').t('validation.required'), 'This field is required.', 'API messages are English');
  assert.equal(createI18n('es').t('no.such.key'), 'no.such.key');
  assert.equal(createI18n('fr').lang, 'en');
});
