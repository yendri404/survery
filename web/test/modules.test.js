import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ERROR_CODES } from '../../api/src/errors.js';
import { barWidth, columnHeight, donutSlices, percent } from '../public/js/charts.js';
import { ERROR_KEYS, errorMessage } from '../public/js/errors.js';
import { addDays, formatTimestamp, safeNext } from '../public/js/format.js';
import { SUPPORTED_LANGUAGES, createI18n, pickLanguage } from '../public/js/i18n.js';
import { NUMBER_TEXT, normalizeNumberText, numberInsert, stepNumber } from '../public/js/number-input.js';
import { backoffDelay, coalesce, createSseParser, followEvents } from '../public/js/sse.js';
import { createVersionWatch } from '../public/js/version.js';
import { createApi } from '../public/js/api.js';
import { checkAnswer, checkRespondentName, checkScaleRange, isValidDate } from '../public/js/validation.js';

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

  test('dates read as short month names in each language', () => {
    assert.equal(createI18n('en', en).formatDate('2026-11-26'), 'Nov 26, 2026');
    assert.equal(createI18n('es', es).formatDate('2026-11-26'), '26 nov 2026');
    assert.equal(createI18n('en', en).formatDate(''), '');
  });
});

describe('format', () => {
  test('timestamps show as "YYYY-MM-DD HH:MM:SS" (UTC)', () => {
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
    // Browsers strip tabs/newlines while parsing URLs, so "/\t/evil" would become "//evil".
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/ /evil.example', 'https://evil.example', 'javascript:alert(1)', '', null]) {
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

  test('scale answers are whole numbers within the range; untouched optional ones pass', () => {
    const scale = { type: 'scale', min: 1, max: 5 };
    assert.equal(check(scale, ''), undefined);
    assert.deepEqual(check({ ...scale, required: true }, ''), { key: 'validation.required', params: {} });
    assert.equal(check(scale, '1'), undefined);
    assert.equal(check(scale, '5'), undefined);
    for (const bad of ['0', '6', '2.5', 'x']) assert.deepEqual(check(scale, bad), { key: 'validation.scaleRange', params: { min: 1, max: 5 } }, bad);
    assert.equal(check({ type: 'scale', min: -2, max: 2 }, '-2'), undefined);
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

  test('a CRLF line ending split between two chunks is one line break', () => {
    const events = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push('event: change\r');
    parser.push('\ndata: 1\r');
    parser.push('\n\r');
    parser.push('\n');
    assert.deepEqual(events, [{ event: 'change', data: '1' }]);
  });

  test('followEvents reconnects after the stream ends or fails, and refreshes once reconnected', async () => {
    const encoder = new TextEncoder();
    // Each body sends a short retry, one change event, then ends (as when the proxy drops the stream).
    const endingBody = () => new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('retry: 5\n\nevent: change\ndata: 1\n\n'));
        controller.close();
      },
    });
    const controller = new AbortController();
    const calls = [];
    let changes = 0;
    const fourthCall = new Promise((resolve) => {
      followEvents({
        url: '/api/v1/surveys/1/events',
        signal: controller.signal,
        onChange: () => { changes += 1; },
        fetchImpl: async () => {
          calls.push(Date.now());
          if (calls.length === 4) resolve();
          if (calls.length === 2) throw new TypeError('network error');
          return { status: 200, ok: true, body: endingBody() };
        },
      });
    });
    let timer;
    await Promise.race([fourthCall, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`only ${calls.length} connections`)), 3000); })]);
    clearTimeout(timer);
    controller.abort();
    assert.equal(calls.length, 4);
    // Connection 1: its event. Connection 3: the catch-up refresh plus its event.
    assert.ok(changes >= 3, `changes: ${changes}`);
  });

  test('a burst of change events makes one refresh, and refreshes never overlap', async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let runs = 0;
    let active = 0;
    let overlapped = false;
    const refresh = coalesce(async () => {
      runs += 1;
      active += 1;
      if (active > 1) overlapped = true;
      await sleep(60);
      active -= 1;
    }, 20);
    for (let i = 0; i < 10; i++) refresh(); // ten events at once
    await sleep(120);
    assert.equal(runs, 1);
    refresh(); // starts a second run...
    await sleep(40);
    refresh(); // ...events while it runs queue exactly one more
    refresh();
    await sleep(250);
    assert.equal(runs, 3);
    assert.equal(overlapped, false);
  });

  test('reconnection waits longer after each failure, up to a ceiling', () => {
    assert.equal(backoffDelay(0, 3000), 3000);
    assert.equal(backoffDelay(1, 3000), 6000);
    assert.equal(backoffDelay(10, 3000), 30000);
  });
});

describe('scale range in the builder (same rules as the API)', () => {
  const RULES = { defaultMin: 1, defaultMax: 10, lowest: -1000, highest: 1000, maxSteps: 100 };
  test('whole numbers within the bounds, "from" below "to", at most maxSteps apart', () => {
    assert.equal(checkScaleRange('1', '10', RULES), undefined);
    assert.equal(checkScaleRange(-50, 50, RULES), undefined);
    for (const [min, max] of [['', '5'], ['1.5', '5'], ['1', 'x'], ['-1001', '0'], ['0', '1001']]) {
      assert.deepEqual(checkScaleRange(min, max, RULES), { key: 'client.builder.scaleBoundInvalid', params: { lowest: -1000, highest: 1000 } }, `${min}..${max}`);
    }
    assert.deepEqual(checkScaleRange('5', '5', RULES), { key: 'client.builder.scaleOrder', params: {} });
    assert.deepEqual(checkScaleRange('10', '1', RULES), { key: 'client.builder.scaleOrder', params: {} });
    assert.deepEqual(checkScaleRange('0', '101', RULES), { key: 'client.builder.scaleTooWide', params: { maxSteps: 100 } });
  });
});

describe('charts', () => {
  test('histogram columns are scaled to the tallest count', () => {
    assert.equal(columnHeight(4, 4), 100);
    assert.equal(columnHeight(1, 3), 33.33);
    assert.equal(columnHeight(0, 3), 0);
    assert.equal(columnHeight(0, 0), 0);
  });

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

describe('results table', () => {
  // Just enough DOM for dom.js h()/s(): elements with attributes, children and listeners.
  class FakeNode {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { (this.listeners ??= {})[name] = fn; }
    append(child) { this.children.push(child); }
    get textContent() { return this.children.map((c) => (c instanceof FakeNode ? c.textContent : c.text)).join(''); }
  }
  class FakeSvg extends FakeNode {}
  const findAll = (node, pred, out = []) => {
    if (node instanceof FakeNode) {
      if (pred(node)) out.push(node);
      for (const child of node.children) findAll(child, pred, out);
    }
    return out;
  };

  test('rows show the per-survey number, not the app-wide id', async (t) => {
    const saved = { Node: globalThis.Node, SVGElement: globalThis.SVGElement, document: globalThis.document };
    Object.assign(globalThis, {
      Node: FakeNode,
      SVGElement: FakeSvg,
      document: {
        createElement: (tag) => new FakeNode(tag),
        createElementNS: (_ns, tag) => new FakeSvg(tag),
        createTextNode: (text) => ({ text }),
      },
    });
    t.after(() => Object.assign(globalThis, saved));
    const { responsesTable } = await import('../public/js/components/results.js');
    const { t: tr } = createI18n('en', en, en);
    const fields = [{ id: 'q1', label: 'Q', type: 'text' }];
    const responses = [
      { id: 41, number: 2, submittedAt: '2026-11-02T10:00:00Z', respondentName: null, answers: { q1: 'b' } },
      { id: 17, number: 1, submittedAt: '2026-11-01T10:00:00Z', respondentName: 'Ana', answers: { q1: 'a' } },
    ];
    const deleted = [];
    const [, wrap] = responsesTable(fields, responses, { t: tr }, (r) => deleted.push(r));
    const firstCells = findAll(wrap, (n) => n.tag === 'tr').slice(1).map((row) => row.children[0].textContent);
    assert.deepEqual(firstCells, ['#2', '#1']);
    const labels = findAll(wrap, (n) => n.tag === 'button').map((b) => b.attrs['aria-label']);
    assert.deepEqual(labels, ['Delete response #2', 'Delete response #1']);
  });
});

describe('survey cards', () => {
  test('each card links to the survey and has Edit, Close or Reopen, and Delete for that survey', async (t) => {
    class Node {
      constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
      setAttribute(name, value) { this.attrs[name] = value; }
      addEventListener(name, fn) { (this.listeners ??= {})[name] = fn; }
      append(child) { this.children.push(child); }
      get textContent() { return this.children.map((c) => (c instanceof Node ? c.textContent : c.text)).join(''); }
    }
    const findAll = (node, pred, out = []) => {
      if (node instanceof Node) {
        if (pred(node)) out.push(node);
        for (const child of node.children) findAll(child, pred, out);
      }
      return out;
    };
    const saved = { Node: globalThis.Node, SVGElement: globalThis.SVGElement, document: globalThis.document };
    Object.assign(globalThis, {
      Node,
      SVGElement: class extends Node {},
      document: { createElement: (tag) => new Node(tag), createElementNS: (_ns, tag) => new Node(tag), createTextNode: (text) => ({ text }) },
    });
    t.after(() => Object.assign(globalThis, saved));
    const { surveyCards } = await import('../public/js/components/survey-cards.js');
    const i18n = createI18n('en', en, en);
    const surveys = [
      { id: 7, title: 'Lunch', status: 'open', isOpen: true, responseCount: 2, closesOn: '2026-12-01' },
      { id: 9, title: 'Parking', status: 'closed', isOpen: false, responseCount: 0, closesOn: '2026-12-05' },
    ];
    const deleted = [];
    const toggled = [];
    const list = surveyCards(surveys, i18n, { onToggle: (s) => toggled.push(s.id), onDelete: (s) => deleted.push(s.id) });
    const hrefs = findAll(list, (n) => n.tag === 'a').map((a) => a.attrs.href);
    assert.deepEqual(hrefs, ['/surveys/7', '/surveys/7/edit', '/surveys/9', '/surveys/9/edit']);
    const editLabels = findAll(list, (n) => n.tag === 'a' && n.attrs.href.endsWith('/edit')).map((a) => a.attrs['aria-label']);
    assert.deepEqual(editLabels, ['Edit "Lunch"', 'Edit "Parking"']);
    const buttons = findAll(list, (n) => n.tag === 'button');
    assert.deepEqual(buttons.map((b) => b.attrs['aria-label']), [
      'Close "Lunch" (stop accepting answers)', 'Delete "Lunch"',
      'Reopen "Parking" (accept answers again)', 'Delete "Parking"',
    ]);
    assert.deepEqual(buttons.map((b) => b.textContent.trim()), ['Close', 'Delete', 'Reopen', 'Delete']);
    // Open surveys wear the "open" colors; closed (and expired) ones keep the blue brand.
    const cardClasses = findAll(list, (n) => n.attrs.class?.includes('survey-card')).map((c) => c.attrs.class.includes('tone-open'));
    assert.deepEqual(cardClasses, [true, false]);
    buttons[0].listeners.click();
    buttons[2].listeners.click();
    buttons[3].listeners.click();
    assert.deepEqual(toggled, [7, 9]);
    assert.deepEqual(deleted, [9]);
  });
});

describe('new client version', () => {
  test('the first version seen is the one running; a different one later marks it stale, once', () => {
    const changes = [];
    const watch = createVersionWatch({ onChange: () => changes.push('changed') });
    watch.see(null); // answers without the header (another server) are ignored
    watch.see('v1');
    watch.see('v1');
    assert.equal(watch.stale, false);
    watch.see('v2');
    watch.see('v3');
    assert.equal(watch.stale, true);
    assert.deepEqual(changes, ['changed']);
  });

  test('the API client reports the version of every answer, including errors', async () => {
    const seen = [];
    const answers = [
      new Response('{"ok":true}', { status: 200, headers: { 'X-Sharevy-Version': 'v1' } }),
      new Response('{"error":{"code":"not_found"}}', { status: 404, headers: { 'X-Sharevy-Version': 'v2' } }),
    ];
    const api = createApi({ getToken: () => null, onVersion: (v) => seen.push(v), fetchImpl: async () => answers.shift() });
    assert.deepEqual(await api.get('/meta'), { ok: true });
    await assert.rejects(api.get('/surveys/1'), { code: 'not_found' });
    assert.deepEqual(seen, ['v1', 'v2']);
  });
});
