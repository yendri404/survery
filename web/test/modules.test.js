import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ERROR_CODES } from '../../api/src/errors.js';
import { barWidth, columnHeight, donutSlices, percent } from '../public/js/charts.js';
import { ERROR_KEYS, errorMessage } from '../public/js/errors.js';
import { addDays, formatTimestamp, localDateTime, safeNext } from '../public/js/format.js';
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
    assert.equal(pickLanguage(null, ['de', 'fr']), 'en');
    assert.equal(pickLanguage(null, ['de', 'pt-BR', 'es']), 'pt', 'Portuguese, any region');
    assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'es', 'pt']);
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
    assert.equal(createI18n('pt', locale('pt')).formatDate('2026-11-26'), '26 de nov. de 2026');
    assert.equal(locale('pt')['language.name'], 'Português');
    assert.equal(createI18n('pt', locale('pt'), en).tn('list.responses', 2), '2 respostas');
    assert.equal(createI18n('en', en).formatDate(''), '');
  });
});

describe('format', () => {
  test('timestamps show as "YYYY-MM-DD HH:MM:SS" in the viewer\'s time zone', () => {
    assert.equal(formatTimestamp('2026-11-17T10:05:00Z', 'UTC'), '2026-11-17 10:05:00');
    assert.equal(formatTimestamp('2026-11-17T02:05:09Z', 'America/Caracas'), '2026-11-16 22:05:09'); // UTC-4: the day before
    assert.equal(formatTimestamp('2026-11-17T20:00:00Z', 'Asia/Kolkata'), '2026-11-18 01:30:00'); // UTC+5:30
    assert.equal(formatTimestamp(''), '');
  });

  test('localDateTime splits a timestamp into the local date and HH:MM', () => {
    assert.deepEqual(localDateTime('2026-11-17T02:05:09Z', 'America/Caracas'), { date: '2026-11-16', time: '22:05' });
    assert.equal(localDateTime(null), null);
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

  test('the name may be left empty unless the survey requires it', () => {
    for (const empty of ['', '   ', undefined]) {
      assert.equal(checkRespondentName(empty, LIMITS), undefined);
      assert.equal(checkRespondentName(empty, LIMITS, { required: false }), undefined);
      assert.deepEqual(checkRespondentName(empty, LIMITS, { required: true }), { key: 'validation.respondentNameRequired', params: {} });
    }
    assert.equal(checkRespondentName(' Ana ', LIMITS, { required: true }), undefined);
    assert.deepEqual(checkRespondentName('x'.repeat(101), LIMITS, { required: true }), { key: 'validation.respondentNameTooLong', params: { max: 100 } });
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

  test('the brand in the top bar always links home, respondent pages included; respondents still get no account menu', async (t) => {
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
    const { topbar } = await import('../public/js/components/layout.js');
    const { t: tr } = createI18n('en', en, en);
    for (const [respondent, user] of [[true, null], [false, null], [false, { name: 'Ana' }]]) {
      const bar = topbar({ t: tr, user, respondent, languageMenuNode: null, themeToggleNode: null, onLogout: () => {} });
      const brand = findAll(bar, (n) => n.attrs?.class === 'brand');
      assert.equal(brand.length, 1);
      assert.equal(brand[0].tag, 'a', `respondent: ${respondent}`);
      assert.equal(brand[0].attrs.href, '/');
      assert.equal(findAll(bar, (n) => n.tag === 'nav').length, respondent ? 0 : 1);
    }
  });

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
    const labels = findAll(wrap, (n) => n.tag === 'form').map((form) => findAll(form, (n) => n.tag === 'button')[0].attrs['aria-label']);
    assert.deepEqual(labels, ['Delete response #2', 'Delete response #1']);
  });

  test('long paragraph answers start cut to 5 lines and open fully on a tap; short ones and other types stay as text', async (t) => {
    const saved = { Node: globalThis.Node, SVGElement: globalThis.SVGElement, document: globalThis.document };
    Object.assign(globalThis, {
      Node: FakeNode,
      SVGElement: FakeSvg,
      document: { createElement: (tag) => new FakeNode(tag), createElementNS: (_ns, tag) => new FakeSvg(tag), createTextNode: (text) => ({ text }) },
    });
    t.after(() => Object.assign(globalThis, saved));
    const { responsesTable, isLongText } = await import('../public/js/components/results.js');
    const { t: tr } = createI18n('en', en, en);
    const long = 'Detail. '.repeat(60);
    const sixLines = ['1', '2', '3', '4', '5', '6'].join('\n');
    assert.equal(isLongText(long), true);
    assert.equal(isLongText(sixLines), true);
    assert.equal(isLongText('Short comment.'), false);
    assert.equal(isLongText(['1', '2', '3', '4', '5'].join('\n')), false);

    const fields = [{ id: 'p', label: 'Comments', type: 'textarea' }, { id: 's', label: 'Word', type: 'text' }];
    const responses = [
      { id: 1, number: 1, submittedAt: '2026-11-01T10:00:00Z', respondentName: null, answers: { p: long, s: long } },
      { id: 2, number: 2, submittedAt: '2026-11-01T10:00:00Z', respondentName: null, answers: { p: 'Short comment.' } },
    ];
    const [, wrap] = responsesTable(fields, responses, { t: tr });
    const clamps = findAll(wrap, (n) => n.attrs.class === 'answer-clamp');
    assert.equal(clamps.length, 1, 'only the long paragraph answer is cut');
    const [clamp] = clamps;
    assert.equal(clamp.tag, 'button');
    assert.equal(clamp.textContent, long);
    assert.equal(clamp.attrs['aria-expanded'], 'false');
    assert.equal(clamp.attrs.title, 'Show the whole answer');
    clamp.listeners.click();
    assert.equal(clamp.attrs['aria-expanded'], 'true');
    assert.equal(clamp.attrs.title, 'Show less');
    clamp.listeners.click();
    assert.equal(clamp.attrs['aria-expanded'], 'false');
  });
});

describe('public results (read-only views)', () => {
  // Just enough DOM for dom.js h()/s(): elements with attributes, properties, children and listeners.
  class FakeNode {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { (this.listeners ??= {})[name] = fn; }
    append(child) { this.children.push(child); }
    get textContent() { return this.children.map((c) => (c instanceof FakeNode ? c.textContent : c.text ?? '')).join(''); }
  }
  const findAll = (node, pred, out = []) => {
    if (Array.isArray(node)) {
      for (const n of node) findAll(n, pred, out);
    } else if (node instanceof FakeNode) {
      if (pred(node)) out.push(node);
      for (const child of node.children) findAll(child, pred, out);
    }
    return out;
  };
  const useFakeDom = (t) => {
    const saved = { Node: globalThis.Node, SVGElement: globalThis.SVGElement, document: globalThis.document };
    Object.assign(globalThis, {
      Node: FakeNode,
      SVGElement: class extends FakeNode {},
      document: { createElement: (tag) => new FakeNode(tag), createElementNS: (_ns, tag) => new FakeNode(tag), createTextNode: (text) => ({ text }), createComment: () => ({ text: '' }) },
    });
    t.after(() => Object.assign(globalThis, saved));
  };
  const fields = [{ id: 'q1', label: 'Q', type: 'text' }];
  const responses = [{ id: 41, number: 1, submittedAt: '2026-11-02T10:00:00Z', respondentName: 'Ana', answers: { q1: 'b' } }];

  test('without a delete action the responses table has names but no delete buttons or actions column', async (t) => {
    useFakeDom(t);
    const { responsesTable } = await import('../public/js/components/results.js');
    const i18n = createI18n('en', en, en);
    const [, wrap] = responsesTable(fields, responses, i18n);
    // Only the scroll buttons: no delete forms or buttons.
    assert.equal(findAll(wrap, (n) => n.tag === 'form' || (n.tag === 'button' && !n.attrs['aria-label']?.startsWith('Scroll'))).length, 0);
    assert.deepEqual(findAll(wrap, (n) => n.tag === 'th').map((th) => th.textContent), ['#', 'Sent', 'Name', 'Q']);
    assert.deepEqual(findAll(wrap, (n) => n.tag === 'td').map((td) => td.textContent).slice(2), ['Ana', 'b']);
    // The read-only empty state does not ask the viewer to share a link.
    const [empty] = responsesTable(fields, [], i18n);
    assert.equal(empty.textContent, en['results.noAnswers']);
  });

  test('read-only results content has figures, charts and answers but no export or delete controls', async (t) => {
    useFakeDom(t);
    const { resultsContent } = await import('../public/js/components/survey-detail.js');
    const i18n = createI18n('en', en, en);
    const summary = { kpis: { total: 1, named: 1, anonymous: 0, lastResponseAt: '2026-11-02T10:00:00Z', status: 'open', closesOn: '2026-12-01', daysLeft: 3 }, questions: [] };
    const nodes = resultsContent({ survey: { fields }, summary, responses }, i18n);
    // Buttons only to switch the view and scroll the table: no export, no delete forms.
    const viewing = new Set(['Table', 'By question']);
    assert.equal(findAll(nodes, (n) => n.tag === 'form' || (n.tag === 'button' && !n.attrs['aria-label']?.startsWith('Scroll') && !viewing.has(n.textContent.trim()))).length, 0);
    assert.equal(findAll(nodes, (n) => n.attrs.role === 'group').length, 1, 'the view switch');
    assert.equal(findAll(nodes, (n) => n.attrs.class === 'kpis').length, 1);
    assert.equal(findAll(nodes, (n) => n.tag === 'table').length, 1);
  });

  test('public results panel: a switch, and the link with a copy button and a warning only while on', async (t) => {
    useFakeDom(t);
    const { publicResultsPanel } = await import('../public/js/components/survey-detail.js');
    const toggled = [];
    const copied = [];
    const panel = (survey) => publicResultsPanel({ t: createI18n('en', en, en).t, survey, onToggle: (on) => toggled.push(on), onCopy: (_btn, input) => copied.push(input.value) });

    const off = panel({ publicResults: false, resultsUrl: null });
    const [offSwitch] = findAll(off, (n) => n.tag === 'input');
    assert.equal(offSwitch.attrs.type, 'checkbox');
    assert.ok(!offSwitch.checked);
    assert.match(off.textContent, /Public results/);
    assert.equal(findAll(off, (n) => n.tag === 'button').length, 0, 'no link to copy while off');
    offSwitch.listeners.change({ currentTarget: { checked: true } });

    const on = panel({ publicResults: true, resultsUrl: 'http://web.local/r/abc' });
    const [onSwitch, link] = findAll(on, (n) => n.tag === 'input');
    assert.equal(onSwitch.checked, true);
    assert.equal(link.value, 'http://web.local/r/abc');
    assert.equal(link.readOnly, true);
    assert.match(on.textContent, /including every answer and the names/);
    assert.match(on.textContent, /creates a new link/);
    const [copy] = findAll(on, (n) => n.tag === 'button');
    assert.equal(copy.textContent.trim(), 'Copy results link');
    copy.listeners.click({ currentTarget: copy });
    onSwitch.listeners.change({ currentTarget: { checked: false } });
    assert.deepEqual(toggled, [true, false]);
    assert.deepEqual(copied, ['http://web.local/r/abc']);
  });

  test('/r/<token> is a public route with its own not-found message', async (t) => {
    useFakeDom(t);
    const { matchRoute } = await import('../public/js/routes.js');
    const match = matchRoute('/r/AbC_-9');
    assert.equal(match.route.page.name, 'publicResultsPage');
    assert.deepEqual(match.params, { token: 'AbC_-9' });
    assert.ok(!match.route.auth);
    assert.equal(match.route.errorKeys.not_found, 'results.notPublic');
    assert.equal(en['results.notPublic'], 'These results are not public.');
    assert.equal(es['results.notPublic'], 'Estos resultados no son públicos.');
    assert.equal(matchRoute('/r/'), undefined);
  });
});

describe('answers views (table or by question)', () => {
  // Enough DOM for h()/s()/slot(): attributes, properties, children with parents, listeners, replaceWith.
  class FakeNode {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { (this.listeners ??= {})[name] = fn; }
    append(child) { if (child && typeof child === 'object') child.parent = this; this.children.push(child); }
    replaceWith(node) {
      const siblings = this.parent.children;
      siblings[siblings.indexOf(this)] = node;
      node.parent = this.parent;
    }
    isEqualNode() { return false; }
    get textContent() { return this.children.map((c) => (c instanceof FakeNode ? c.textContent : c.text ?? '')).join(''); }
  }
  const findAll = (node, pred, out = []) => {
    if (Array.isArray(node)) {
      for (const n of node) findAll(n, pred, out);
    } else if (node instanceof FakeNode) {
      if (pred(node)) out.push(node);
      for (const child of node.children) findAll(child, pred, out);
    }
    return out;
  };
  const useFakeDom = (t) => {
    const saved = { Node: globalThis.Node, SVGElement: globalThis.SVGElement, document: globalThis.document };
    Object.assign(globalThis, {
      Node: FakeNode,
      SVGElement: class extends FakeNode {},
      document: {
        createElement: (tag) => new FakeNode(tag),
        createElementNS: (_ns, tag) => new FakeNode(tag),
        createTextNode: (text) => ({ text }),
        createComment: () => Object.assign(new FakeNode('#comment'), {}),
      },
    });
    t.after(() => Object.assign(globalThis, saved));
  };
  const hasClass = (node, name) => (node.attrs.class ?? '').split(' ').includes(name);
  const long = 'Detail. '.repeat(60);
  const fields = [
    { id: 'name', label: 'Team', type: 'text' },
    { id: 'pick', label: 'Lunch', type: 'yesno' },
    { id: 'notes', label: 'Notes', type: 'textarea' },
  ];
  // Newest first, as the API sends them.
  const responses = [
    { id: 30, number: 3, submittedAt: '2026-11-03T10:00:00Z', respondentName: null, answers: { name: 'Ops', pick: 'yes', notes: long } },
    { id: 20, number: 2, submittedAt: '2026-11-02T10:00:00Z', respondentName: 'Ana', answers: { name: '', pick: 'no', notes: 'Short.' } },
    { id: 10, number: 1, submittedAt: '2026-11-01T10:00:00Z', respondentName: 'Luis', answers: { pick: 'yes' } },
  ];

  test('default view: the table up to 5 questions, "by question" from 6', async () => {
    const { defaultAnswersView } = await import('../public/js/components/answers-by-question.js');
    assert.equal(defaultAnswersView(1), 'table');
    assert.equal(defaultAnswersView(5), 'table');
    assert.equal(defaultAnswersView(6), 'byQuestion');
    assert.equal(defaultAnswersView(40), 'byQuestion');
  });

  test('answers to one question: only non-empty ones, in the order given, and how many left it empty', async () => {
    const { answersForQuestion } = await import('../public/js/components/answers-by-question.js');
    const team = answersForQuestion(fields[0], responses);
    assert.deepEqual(team.answered.map((r) => r.number), [3]);
    assert.equal(team.unanswered, 2);
    const pick = answersForQuestion(fields[1], responses);
    assert.deepEqual(pick.answered.map((r) => r.number), [3, 2, 1]);
    assert.equal(pick.unanswered, 0);
    const multi = answersForQuestion({ id: 'm', type: 'checkbox' }, [{ answers: { m: [] } }, { answers: { m: ['a'] } }, { answers: { m: '0' } }]);
    assert.equal(multi.answered.length, 2, 'an empty choice list is no answer; "0" is one');
    assert.equal(multi.unanswered, 1);
  });

  test('by question: each answer with its name or "Anonymous", #N and time, newest first, plus the unanswered count', async (t) => {
    useFakeDom(t);
    const { answersByQuestion } = await import('../public/js/components/answers-by-question.js');
    const i18n = createI18n('en', en, en);
    const view = answersByQuestion(fields, responses, i18n, { question: 'pick' });
    const items = findAll(view, (n) => hasClass(n, 'answer-item'));
    assert.equal(items.length, 3);
    assert.match(items[0].textContent, /^Yes/);
    assert.match(items[0].textContent, /Anonymous/);
    assert.match(items[0].textContent, /#3/);
    assert.match(items[0].textContent, new RegExp(formatTimestamp('2026-11-03T10:00:00Z')));
    assert.match(items[1].textContent, /^No.*Ana.*#2/);
    assert.match(items[2].textContent, /Luis.*#1/);
    assert.equal(findAll(view, (n) => hasClass(n, 'unanswered')).length, 0, 'no line when everyone answered');
    assert.equal(findAll(view, (n) => n.tag === 'form' || hasClass(n, 'danger')).length, 0, 'read-only without onDelete');

    const team = answersByQuestion(fields, responses, i18n, { question: 'name' });
    assert.equal(findAll(team, (n) => hasClass(n, 'answer-item')).length, 1);
    const [line] = findAll(team, (n) => hasClass(n, 'unanswered'));
    assert.equal(line.textContent, '2 people did not answer this question.');
    assert.equal(createI18n('es', es, en).tn('detail.unanswered', 1), '1 persona no respondió esta pregunta.');
    assert.equal(createI18n('es', es, en).tn('detail.unanswered', 4), '4 personas no respondieron esta pregunta.');
  });

  test('by question: long paragraph answers use the same 5-line clamp as the table', async (t) => {
    useFakeDom(t);
    const { answersByQuestion } = await import('../public/js/components/answers-by-question.js');
    const view = answersByQuestion(fields, responses, createI18n('en', en, en), { question: 'notes' });
    const clamps = findAll(view, (n) => n.attrs.class === 'answer-clamp');
    assert.equal(clamps.length, 1, 'only the long answer is cut');
    assert.equal(clamps[0].textContent, long);
    clamps[0].listeners.click();
    assert.equal(clamps[0].attrs['aria-expanded'], 'true');
    assert.match(findAll(view, (n) => hasClass(n, 'answer-item'))[1].textContent, /^Short\./);
  });

  test('by question: a labeled picker of every question; previous/next change it and stop at the ends', async (t) => {
    useFakeDom(t);
    const { answersByQuestion } = await import('../public/js/components/answers-by-question.js');
    const chosen = [];
    const view = answersByQuestion(fields, responses, createI18n('en', en, en), { question: null, onQuestion: (id) => chosen.push(id) });
    const [select] = findAll(view, (n) => n.tag === 'select');
    const [label] = findAll(view, (n) => n.tag === 'label');
    assert.equal(label.attrs.for, select.attrs.id);
    assert.equal(label.textContent, 'Question');
    assert.deepEqual(findAll(select, (n) => n.tag === 'option').map((o) => o.textContent), ['1. Team', '2. Lunch', '3. Notes']);
    const [prev, next] = findAll(view, (n) => n.tag === 'button' && n.attrs['aria-label']);
    assert.equal(prev.attrs['aria-label'], 'Previous question');
    assert.equal(next.attrs['aria-label'], 'Next question');
    // No saved question: the first one.
    assert.equal(select.value, 'name');
    assert.equal(prev.disabled, true);
    assert.equal(next.disabled, false);
    next.listeners.click();
    assert.equal(select.value, 'pick');
    assert.equal(findAll(view, (n) => hasClass(n, 'answer-item')).length, 3, 'the list follows the question');
    assert.equal(prev.disabled, false);
    next.listeners.click();
    assert.equal(next.disabled, true);
    prev.listeners.click();
    select.listeners.change({ currentTarget: { value: 'notes' } });
    assert.deepEqual(chosen, ['pick', 'notes', 'pick', 'notes']);
    assert.equal(next.disabled, true);
    // An unknown saved question (deleted meanwhile) falls back to the first one.
    const [again] = findAll(answersByQuestion(fields, responses, createI18n('en', en, en), { question: 'gone' }), (n) => n.tag === 'select');
    assert.equal(again.value, 'name');
  });

  test('by question: the creator gets the same delete button per response as in the table', async (t) => {
    useFakeDom(t);
    const { answersByQuestion } = await import('../public/js/components/answers-by-question.js');
    const deleted = [];
    const view = answersByQuestion(fields, responses, createI18n('en', en, en), { question: 'pick', onDelete: (r) => deleted.push(r.id) });
    const forms = findAll(view, (n) => n.tag === 'form');
    assert.deepEqual(findAll(forms, (n) => n.tag === 'button').map((b) => b.attrs['aria-label']), ['Delete response #3', 'Delete response #2', 'Delete response #1']);
    forms[1].listeners.submit({ preventDefault() {} });
    assert.deepEqual(deleted, [20]);
  });

  test('view switch: "Table" / "By question" with aria-pressed, defaulting by question count; a pick is reported', async (t) => {
    useFakeDom(t);
    const { answersSection } = await import('../public/js/components/answers-by-question.js');
    const i18n = createI18n('en', en, en);
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, label: `Q${i}`, type: 'text' }));
    const pressed = (nodes) => findAll(nodes, (n) => n.attrs['aria-pressed'] === 'true').map((b) => b.textContent.trim());
    assert.deepEqual(pressed(answersSection(fields, responses, i18n, {})), ['Table']);
    assert.deepEqual(pressed(answersSection(many, responses, i18n, {})), ['By question']);
    assert.deepEqual(pressed(answersSection(many, responses, i18n, { state: { view: 'table' } })), ['Table'], 'a saved choice wins');
    assert.deepEqual(pressed(answersSection(many, responses, i18n, { state: { view: 'bogus' } })), ['By question']);

    const changes = [];
    const nodes = answersSection(fields, responses, i18n, { state: { view: null, question: 'notes' }, onChange: (c) => changes.push(c) });
    const [group] = findAll(nodes, (n) => n.attrs.role === 'group');
    assert.equal(group.attrs['aria-label'], 'Answers view');
    assert.equal(findAll(nodes, (n) => n.tag === 'table').length, 1);
    const [tableButton, byQuestionButton] = findAll(group, (n) => n.tag === 'button');
    byQuestionButton.listeners.click();
    assert.deepEqual(changes, [{ view: 'byQuestion' }]);
    assert.deepEqual(pressed(nodes), ['By question']);
    assert.equal(findAll(nodes, (n) => n.tag === 'table').length, 0);
    assert.equal(findAll(nodes, (n) => n.tag === 'select')[0].value, 'notes', 'the saved question is shown');
    findAll(nodes, (n) => n.attrs['aria-label'] === 'Previous question')[0].listeners.click();
    assert.deepEqual(changes.at(-1), { question: 'pick' });
    byQuestionButton.listeners.click();
    assert.equal(changes.length, 2, 'picking the current view changes nothing');
    tableButton.listeners.click();
    assert.deepEqual(changes.at(-1), { view: 'table' });
    assert.equal(findAll(nodes, (n) => n.tag === 'table').length, 1);
    // No answers yet: the empty state only, no switch.
    const empty = answersSection(fields, [], i18n, {});
    assert.equal(findAll(empty, (n) => n.attrs.role === 'group').length, 0);
    assert.equal(findAll(empty, (n) => n.attrs.class === 'empty').length, 1);
  });

  test('table scroll bar margins: the sticky bar rests at the bottom of the header and the table keeps its place', async () => {
    const { scrollbarMargins } = await import('../public/js/components/results.js');
    // Header 80px tall, bar 22px: the bar starts 57px down (its bottom 1px above the header's bottom
    // border) and the table is pulled back up by the bar's height plus that margin.
    assert.deepEqual(scrollbarMargins(80, 22), { bar: 57, box: -79 });
    // No header (or not measured yet): the bar never gets a negative margin.
    assert.deepEqual(scrollbarMargins(0, 22), { bar: 0, box: -22 });
  });

  test('table: a scroll bar under the header and a hint, both hidden until the table overflows; no scroll buttons', async (t) => {
    useFakeDom(t);
    const { responsesTable } = await import('../public/js/components/results.js');
    const [, wrap] = responsesTable(fields, responses, createI18n('en', en, en));
    const [bar] = findAll(wrap, (n) => hasClass(n, 'table-scrollbar'));
    assert.ok(bar, 'a scroll bar element exists');
    assert.equal(bar.hidden, true);
    const [hint] = findAll(wrap, (n) => hasClass(n, 'table-scroll-hint'));
    assert.equal(hint.hidden, true);
    assert.equal(hint.textContent.trim(), en['detail.scrollHint']);
    assert.equal(es['detail.scrollHint'], 'Desliza la barra para ver todas las columnas.');
    assert.equal(findAll(wrap, (n) => hasClass(n, 'table-toolbar') || hasClass(n, 'scroll-button')).length, 0);
    // Keyboard users scroll the table itself (focusable region with a name).
    const [box] = findAll(wrap, (n) => hasClass(n, 'table-wrap'));
    assert.equal(String(box.attrs.tabindex), '0');
    assert.equal(box.attrs.role, 'region');
    assert.equal(box.attrs['aria-label'], en['detail.allAnswers']);
    // The whole table scrolls: no column stays fixed.
    assert.equal(findAll(wrap, (n) => hasClass(n, 'sticky-col')).length, 0);
  });

  test('the remembered view and question are kept per survey (creator) or per results link (public)', async () => {
    const { rememberedAnswersView, answersViewKeys } = await import('../public/js/storage.js');
    assert.deepEqual(answersViewKeys('survey:7'), { view: 'sharevy-answers-view:survey:7', question: 'sharevy-answers-question:survey:7' });
    const first = rememberedAnswersView('survey:7');
    assert.deepEqual(first.state, { view: null, question: null });
    first.onChange({ view: 'table' });
    first.onChange({ question: 'q3' });
    assert.deepEqual(first.state, { view: 'table', question: 'q3' });
    assert.deepEqual(rememberedAnswersView('survey:7').state, { view: 'table', question: 'q3' }, 'read back later');
    assert.deepEqual(rememberedAnswersView('results:abc').state, { view: null, question: null }, 'other surveys keep their own');
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

  test('downloads keep the exact UTF-8 file name the API sends (filename*), else the ASCII one', async () => {
    const file = (disposition) => createApi({
      getToken: () => 't',
      fetchImpl: async () => new Response('x', { status: 200, headers: disposition ? { 'Content-Disposition': disposition } : {} }),
    }).file('/surveys/1/export.csv', 'fallback.csv');
    assert.equal((await file("attachment; filename=\"Encuesta ano.csv\"; filename*=UTF-8''Encuesta%20a%C3%B1o.csv")).name, 'Encuesta año.csv');
    assert.equal((await file('attachment; filename="Lunch.csv"')).name, 'Lunch.csv');
    assert.equal((await file(null)).name, 'fallback.csv');
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

describe('admin panel (/..command/)', () => {
  class FakeNode {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { (this.listeners ??= {})[name] = fn; }
    append(child) { if (child && typeof child === 'object') child.parent = this; this.children.push(child); }
    get textContent() { return this.children.map((c) => (c instanceof FakeNode ? c.textContent : c.text ?? '')).join(''); }
  }
  const findAll = (node, pred, out = []) => {
    if (Array.isArray(node)) {
      for (const n of node) findAll(n, pred, out);
    } else if (node instanceof FakeNode) {
      if (pred(node)) out.push(node);
      for (const child of node.children) findAll(child, pred, out);
    }
    return out;
  };
  const useFakeDom = (t) => {
    const saved = { Node: globalThis.Node, SVGElement: globalThis.SVGElement, document: globalThis.document };
    Object.assign(globalThis, {
      Node: FakeNode,
      SVGElement: class extends FakeNode {},
      document: { createElement: (tag) => new FakeNode(tag), createElementNS: (_ns, tag) => new FakeNode(tag), createTextNode: (text) => ({ text }), createComment: () => new FakeNode('#comment') },
    });
    t.after(() => Object.assign(globalThis, saved));
  };
  const i18n = createI18n('en', en, en);

  test('the admin page answers /..command and /..command/, and its editor /..command/surveys/:id/edit; dots are literal', async () => {
    const { matchRoute } = await import('../public/js/routes.js');
    for (const path of ['/..command', '/..command/']) {
      const match = matchRoute(path);
      assert.equal(match?.route.page.name, 'adminPage', path);
      assert.ok(!match.route.auth, 'no creator account needed');
      assert.ok(match.route.respondent, 'no creator account menu');
    }
    const edit = matchRoute('/..command/surveys/12/edit');
    assert.equal(edit.route.page.name, 'adminEditorPage');
    assert.deepEqual(edit.params, { id: '12' });
    assert.equal(matchRoute('/xxcommand'), undefined);
    assert.equal(matchRoute('/..command/surveys/abc/edit'), undefined);
    assert.equal(matchRoute('/surveys/12').route.page.name, 'detailPage', 'other routes unchanged');
  });

  test('panel login text: the plain line, or the playful one only when the API says FUN is on', async () => {
    const { adminLoginIntroKey } = await import('../public/js/components/admin.js');
    assert.equal(adminLoginIntroKey({ fun: false }), 'admin.loginIntro');
    assert.equal(adminLoginIntroKey({}), 'admin.loginIntro', 'an older API without the field');
    assert.equal(adminLoginIntroKey({ fun: true }), 'admin.loginFun');
    assert.equal(es['admin.loginFun'], 'No deberías estar aquí, pero si sabes lo que haces...');
    assert.equal(en['admin.loginFun'], "You shouldn't be here, but if you know what you're doing...");
  });

  test('user cards: name, email and survey count; the selected one is marked; a drop-down edits name, email and password; delete calls back', async (t) => {
    useFakeDom(t);
    const { adminUserCards } = await import('../public/js/components/admin.js');
    const users = [
      { id: 7, name: 'Ana', email: 'ana@corp.local', surveyCount: 2, createdAt: '2026-11-01T10:00:00Z' },
      { id: 9, name: 'Luis', email: 'luis@corp.local', surveyCount: 0, createdAt: '2026-11-02T10:00:00Z' },
    ];
    const deleted = [];
    const passwords = [];
    const saved = [];
    const list = adminUserCards(users, i18n, {
      selectedId: 9,
      onDelete: (u) => deleted.push(u.id),
      onSetPassword: (u, value) => passwords.push([u.id, value]),
      onSaveUser: (u, values) => saved.push([u.id, values]),
    });
    const links = findAll(list, (n) => n.tag === 'a');
    assert.deepEqual(links.map((a) => a.attrs.href), ['/..command/?user=7', '/..command/?user=9']);
    assert.deepEqual(links.map((a) => a.attrs['aria-current']), [undefined, 'true']);
    assert.match(links[0].textContent, /Ana.*ana@corp\.local.*2 surveys/);
    assert.match(links[1].textContent, /No surveys/);
    const deletes = findAll(list, (n) => n.tag === 'button' && /^Delete the user /.test(n.attrs['aria-label']));
    assert.equal(deletes.length, 2);
    deletes[0].listeners.click();
    assert.deepEqual(deleted, [7]);

    // One drop-down menu per card (an icon button), floating over the grid: name and email, then the password.
    const menus = findAll(list, (n) => n.tag === 'details');
    assert.deepEqual(menus.map((m) => m.attrs.class), ['admin-user-menu', 'admin-user-menu']);
    assert.deepEqual(findAll(list, (n) => n.tag === 'summary').map((n) => n.attrs['aria-label']), ['Edit Ana', 'Edit Luis']);
    const [profile, password] = findAll(menus[0], (n) => n.tag === 'form');
    const [name, email] = findAll(profile, (n) => n.tag === 'input');
    assert.deepEqual([name.value, email.value, email.attrs.type, name.attrs.maxlength], ['Ana', 'ana@corp.local', 'email', '100']);
    name.value = 'Ana María';
    email.value = 'ana.maria@corp.local';
    profile.listeners.submit({ preventDefault() {}, currentTarget: profile });
    assert.deepEqual(saved, [[7, { name: 'Ana María', email: 'ana.maria@corp.local' }]]);
    const [secret] = findAll(password, (n) => n.tag === 'input');
    assert.deepEqual([secret.attrs.type, secret.attrs.minlength], ['password', '8']);
    secret.value = 'new-secret-1';
    password.listeners.submit({ preventDefault() {}, currentTarget: password });
    assert.deepEqual(passwords, [[7, 'new-secret-1']]);
    assert.equal(adminUserCards([], i18n, {}).textContent, en['admin.noUsers']);
  });

  test('survey cards: status, edit in the admin editor, open the form, close or reopen, delete', async (t) => {
    useFakeDom(t);
    const { adminSurveyCards } = await import('../public/js/components/admin.js');
    const surveys = [
      { id: 3, title: 'Lunch', status: 'open', isOpen: true, responseCount: 4, closesOn: '2026-12-01', shareUrl: 'http://web.local/s/abc', ownerId: 7 },
      { id: 4, title: 'Old', status: 'closed', isOpen: false, responseCount: 0, closesOn: '2026-12-01', shareUrl: 'http://web.local/s/def', ownerId: 7 },
    ];
    const calls = [];
    const list = adminSurveyCards(surveys, i18n, { onToggle: (s) => calls.push(['toggle', s.id]), onDelete: (s) => calls.push(['delete', s.id]) });
    const hrefs = findAll(list, (n) => n.tag === 'a').map((a) => [a.attrs.href, a.attrs.target]);
    assert.deepEqual(hrefs, [
      ['/..command/surveys/3/edit', undefined], ['http://web.local/s/abc', '_blank'],
      ['/..command/surveys/4/edit', undefined], ['http://web.local/s/def', '_blank'],
    ]);
    const buttons = findAll(list, (n) => n.tag === 'button');
    assert.deepEqual(buttons.map((b) => b.textContent.trim()), ['Close', 'Delete', 'Reopen', 'Delete']);
    for (const b of buttons) b.listeners.click();
    assert.deepEqual(calls, [['toggle', 3], ['delete', 3], ['toggle', 4], ['delete', 4]]);
    assert.match(list.textContent, /Lunch.*Open.*4 responses/);
    assert.equal(adminSurveyCards([], i18n, {}).textContent, en['admin.noSurveys']);
  });
});

describe('survey templates (export / import)', () => {
  const survey = {
    id: 12, title: 'Team lunch: 2027?', description: 'Plan it.', requireName: true, isOpen: true, closesOn: '2026-12-01',
    publicToken: 'secret-token', shareUrl: 'http://x/s/secret-token', responseCount: 40,
    fields: [
      { id: 'a1', label: 'Department', type: 'radio', required: true, options: ['IT', 'HR'] },
      { id: 'b2', label: 'Score', type: 'scale', required: false, options: [], min: 1, max: 5 },
      { id: 'c3', label: 'Comments', type: 'textarea', required: false, options: [] },
    ],
  };

  test('export: only what a new survey needs (no ids, answers, links or dates), with a format tag', async () => {
    const { surveyTemplate } = await import('../public/js/template.js');
    assert.deepEqual(surveyTemplate(survey), {
      format: 'sharevy-survey-template',
      version: 1,
      title: 'Team lunch: 2027?',
      description: 'Plan it.',
      requireName: true,
      fields: [
        { label: 'Department', type: 'radio', required: true, options: ['IT', 'HR'] },
        { label: 'Score', type: 'scale', required: false, min: 1, max: 5 },
        { label: 'Comments', type: 'textarea', required: false },
      ],
    });
  });

  test('file name: the title made safe for files, plus .sharevy.json', async () => {
    const { templateFileName } = await import('../public/js/template.js');
    assert.equal(templateFileName('Team lunch: 2027?'), 'Team lunch 2027.sharevy.json');
    assert.equal(templateFileName('Encuesta / clima "laboral"'), 'Encuesta clima laboral.sharevy.json');
    assert.equal(templateFileName('???'), 'survey.sharevy.json');
  });

  test('import: an exported file reads back the same; unknown keys are dropped', async () => {
    const { parseTemplate, surveyTemplate } = await import('../public/js/template.js');
    const exported = surveyTemplate(survey);
    assert.deepEqual(parseTemplate(JSON.stringify(exported)), { template: exported });
    const extra = { ...exported, publicToken: 'x', fields: [{ ...exported.fields[0], id: 'zz', answers: [1] }] };
    assert.deepEqual(parseTemplate(JSON.stringify(extra)).template.fields, [exported.fields[0]]);
    // Optional parts may be missing.
    const minimal = parseTemplate(JSON.stringify({ format: 'sharevy-survey-template', version: 1, fields: [{ label: 'Q', type: 'text' }] }));
    assert.deepEqual(minimal.template, { format: 'sharevy-survey-template', version: 1, title: '', description: '', requireName: false, fields: [{ label: 'Q', type: 'text', required: false }] });
  });

  test('import refuses what is not a Sharevy template, a newer version, or one without questions', async () => {
    const { parseTemplate } = await import('../public/js/template.js');
    assert.deepEqual(parseTemplate('not json {'), { error: 'template.invalid' });
    assert.deepEqual(parseTemplate('[1, 2]'), { error: 'template.invalid' });
    assert.deepEqual(parseTemplate(JSON.stringify({ title: 'x', fields: [] })), { error: 'template.notSharevy' });
    assert.deepEqual(parseTemplate(JSON.stringify({ format: 'sharevy-survey-template', version: 2, fields: [{ label: 'Q', type: 'text' }] })), { error: 'template.newerVersion' });
    assert.deepEqual(parseTemplate(JSON.stringify({ format: 'sharevy-survey-template', version: 1, fields: [] })), { error: 'template.noQuestions' });
    assert.deepEqual(parseTemplate(JSON.stringify({ format: 'sharevy-survey-template', version: 1, fields: ['x', null] })), { error: 'template.noQuestions' });
    for (const key of ['template.invalid', 'template.notSharevy', 'template.newerVersion', 'template.noQuestions', 'template.tooLarge']) {
      for (const lang of SUPPORTED_LANGUAGES) assert.ok(locale(lang)[key], `${lang} misses ${key}`);
    }
  });
});
