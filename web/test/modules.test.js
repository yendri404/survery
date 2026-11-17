import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ERROR_CODES } from '../../api/src/errors.js';
import { barWidth, donutSlices, percent } from '../public/js/charts.js';
import { ERROR_KEYS, errorMessage } from '../public/js/errors.js';
import { addDays, formatTimestamp, safeNext } from '../public/js/format.js';
import { SUPPORTED_LANGUAGES, createI18n, pickLanguage } from '../public/js/i18n.js';
import { NUMBER_TEXT, normalizeNumberText, numberInsert, stepNumber } from '../public/js/number-input.js';
import { backoffDelay, createSseParser } from '../public/js/sse.js';
import { checkAnswer, checkRespondentName, isValidDate } from '../public/js/validation.js';

const locale = (lang) => JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const en = locale('en');
const es = locale('es');
const LIMITS = { title: 200, description: 2000, label: 300, fields: 100, options: 100, option: 200, text: 1000, textarea: 10000, respondentName: 100 };

describe('locales', () => {
  test('every language has exactly the same keys as English', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      assert.deepEqual(Object.keys(locale(lang)).sort(), Object.keys(en).sort(), lang);
    }
  });

  test('every error code the API can send has a translation in every language', () => {
    const codes = new Set([...Object.values(ERROR_CODES), 'api_unavailable', 'network_error']);
    for (const code of codes) {
      const key = ERROR_KEYS[code];
      assert.ok(key, `no message key for ${code}`);
      for (const lang of SUPPORTED_LANGUAGES) assert.ok(locale(lang)[key], `${lang} misses ${key} (${code})`);
    }
  });

  test('error messages use the code and its params, and context-specific keys when given', () => {
    const { t } = createI18n('es', es, en);
    assert.equal(errorMessage({ code: 'too_many_login_attempts', params: { minutes: 15 } }, t), es['login.tooManyAttempts'].replace('{minutes}', '15'));
    assert.equal(errorMessage({ code: 'not_found' }, t, { not_found: 'respond.notFound' }), es['respond.notFound']);
    assert.equal(errorMessage({ code: 'option_duplicate', params: { n: 2, option: 'IT' } }, t), es['validation.optionDuplicate'].replace('{n}', '2').replace('{option}', 'IT'));
    assert.equal(errorMessage({ code: 'something_new', message: 'English text' }, t), 'English text');
  });
});

describe('i18n', () => {
  test('the saved choice wins, then the browser languages by order (region ignored), then English', () => {
    assert.equal(pickLanguage('es', ['en-US']), 'es');
    assert.equal(pickLanguage('fr', ['fr-FR', 'es-MX', 'en']), 'es');
    assert.equal(pickLanguage(null, ['de', 'pt']), 'en');
    assert.equal(pickLanguage(undefined, undefined), 'en');
  });

  test('t fills {params}, tn picks the plural form, missing keys fall back to English then the key', () => {
    const i18n = createI18n('es', { a: 'Hola {name}', 'n.one': '{count} respuesta', 'n.other': '{count} respuestas' }, { b: 'Fallback' });
    assert.equal(i18n.t('a', { name: 'Ana' }), 'Hola Ana');
    assert.equal(i18n.tn('n', 1), '1 respuesta');
    assert.equal(i18n.tn('n', 3), '3 respuestas');
    assert.equal(i18n.t('b'), 'Fallback');
    assert.equal(i18n.t('zzz'), 'zzz');
    assert.equal(i18n.t('a'), 'Hola {name}');
  });

  test('dates read like the single-server version', () => {
    assert.equal(createI18n('en', en).formatDate('2026-11-26'), 'Nov 26, 2026');
    assert.equal(createI18n('es', es).formatDate('2026-11-26'), '26 nov 2026');
    assert.equal(createI18n('en', en).formatDate(''), '');
  });
});

describe('format', () => {
  test('timestamps show as "YYYY-MM-DD HH:MM:SS" (UTC), like before', () => {
    assert.equal(formatTimestamp('2026-11-17T10:05:00Z'), '2026-11-17 10:05:00');
    assert.equal(formatTimestamp(''), '');
  });

  test('addDays is calendar math', () => {
    assert.equal(addDays('2026-11-17', 10), '2026-11-27');
    assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  });

  test('safeNext keeps only paths of this site', () => {
    assert.equal(safeNext('/surveys/7'), '/surveys/7');
    assert.equal(safeNext('/surveys?msg=x'), '/surveys?msg=x');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', null]) {
      assert.equal(safeNext(bad), '/surveys', String(bad));
    }
  });
});

describe('respondent validation (same rules as the API)', () => {
  const check = (field, value) => checkAnswer({ required: false, options: [], ...field, value }, LIMITS);

  test('required questions need an answer; optional empty ones pass', () => {
    assert.deepEqual(check({ type: 'text', required: true }, '  '), { key: 'validation.required', params: {} });
    assert.equal(check({ type: 'text' }, ''), undefined);
    assert.deepEqual(check({ type: 'checkbox', required: true, options: ['A'] }, []), { key: 'validation.required', params: {} });
    assert.equal(check({ type: 'checkbox', options: ['A'] }, []), undefined);
  });

  test('each type checks its value', () => {
    assert.deepEqual(check({ type: 'text' }, 'x'.repeat(1001)), { key: 'validation.tooLong', params: { max: 1000 } });
    assert.equal(check({ type: 'text' }, 'x'.repeat(1000)), undefined);
    assert.deepEqual(check({ type: 'textarea' }, 'x'.repeat(10001)), { key: 'validation.tooLong', params: { max: 10000 } });
    assert.deepEqual(check({ type: 'number' }, '1e'), { key: 'validation.number', params: {} });
    assert.equal(check({ type: 'number' }, '-4.5'), undefined);
    assert.deepEqual(check({ type: 'email' }, 'nope'), { key: 'validation.email', params: {} });
    assert.equal(check({ type: 'email' }, 'a@b.co'), undefined);
    assert.deepEqual(check({ type: 'date' }, '2026-02-30'), { key: 'validation.date', params: {} });
    assert.equal(check({ type: 'date' }, '2026-02-28'), undefined);
    assert.deepEqual(check({ type: 'select', options: ['IT'] }, 'HR'), { key: 'validation.invalidOption', params: {} });
    assert.equal(check({ type: 'radio', options: ['IT'] }, 'IT'), undefined);
    assert.equal(check({ type: 'yesno' }, 'yes'), undefined);
    assert.deepEqual(check({ type: 'yesno' }, 'maybe'), { key: 'validation.invalidOption', params: {} });
  });

  test('the optional name has a maximum length', () => {
    assert.deepEqual(checkRespondentName('x'.repeat(101), LIMITS), { key: 'validation.respondentNameTooLong', params: { max: 100 } });
    assert.equal(checkRespondentName(` ${'x'.repeat(100)} `, LIMITS), undefined);
  });

  test('isValidDate rejects impossible dates', () => {
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('2027-02-29'), false);
    assert.equal(isValidDate('27-02-01'), false);
  });
});

describe('number input filter', () => {
  test('only digits, one point and a leading minus are accepted', () => {
    for (const ok of ['', '-', '12', '-1.5', '.5', '3.']) assert.ok(NUMBER_TEXT.test(ok), ok);
    for (const bad of ['1e5', '+1', '1.2.3', '1-', 'abc', '--1']) assert.ok(!NUMBER_TEXT.test(bad), bad);
  });

  test('a comma becomes a point and spaces are dropped', () => {
    assert.equal(normalizeNumberText('4,5'), '4.5');
    assert.equal(normalizeNumberText(' 1 000 '), '1000');
  });

  test('insertions are blocked, accepted, or rewritten', () => {
    assert.deepEqual(numberInsert('12', 2, 2, 'a'), { allow: false });
    assert.deepEqual(numberInsert('12', 2, 2, '3'), { allow: true });
    assert.deepEqual(numberInsert('4', 1, 1, ',5'), { allow: true, rewrite: '.5' });
    assert.deepEqual(numberInsert('1.5', 3, 3, '.'), { allow: false });
    assert.deepEqual(numberInsert('15', 0, 2, '-3'), { allow: true });
  });

  test('arrow keys add or subtract 1 without float noise', () => {
    assert.equal(stepNumber('0.1', 1), '1.1');
    assert.equal(stepNumber('', -1), '-1');
    assert.equal(stepNumber('-', 1), undefined);
  });
});

describe('server-sent events', () => {
  test('the parser joins chunks, skips comments and reads retry', () => {
    const events = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push('retry: 3000\n: connected\n\nevent: cha');
    parser.push('nge\ndata: 17\r\n\r\n: ping\n\n');
    parser.push('data: a\ndata: b\n\n');
    assert.deepEqual(events, [{ event: 'change', data: '17' }, { event: 'message', data: 'a\nb' }]);
    assert.equal(parser.retry, 3000);
  });

  test('reconnection waits longer after each failure, up to a ceiling', () => {
    assert.equal(backoffDelay(0, 3000), 3000);
    assert.equal(backoffDelay(1, 3000), 6000);
    assert.equal(backoffDelay(10, 3000), 30000);
  });
});

describe('charts', () => {
  test('percent is rounded and 0 without answers', () => {
    assert.equal(percent(2, 3), 67);
    assert.equal(percent(0, 0), 0);
  });

  test('donut slices: dash lengths are percentages minus a gap, starting at 12 o\'clock', () => {
    const slices = donutSlices([2, 1, 0], 3);
    assert.deepEqual(slices, [
      { index: 0, length: 66.07, rest: 33.93, offset: 25 },
      { index: 1, length: 32.73, rest: 67.27, offset: -41.67 },
    ]);
    assert.deepEqual(donutSlices([4, 0], 4), [{ index: 0, length: 100, rest: 0, offset: 25 }]);
    assert.deepEqual(donutSlices([0, 0], 0), []);
  });

  test('bar widths are the share of people who answered', () => {
    assert.equal(barWidth(1, 3), 33.33);
    assert.equal(barWidth(0, 0), 0);
  });
});
