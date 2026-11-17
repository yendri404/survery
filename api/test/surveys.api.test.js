import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import QRCode from 'qrcode';
import { hashPassword } from '../src/auth.js';
import { Client, answer, newDeviceId, startApi } from './helpers.js';

const FIELDS = [
  { label: 'Your name', type: 'text', required: true },
  { label: 'Department', type: 'select', required: true, options: ['IT', 'HR'] },
  { label: 'Tools', type: 'checkbox', options: ['Mail', 'Chat'] },
];

async function creator(base, email) {
  const c = new Client(base);
  const res = await c.register(email);
  assert.equal(res.status, 201, res.text);
  return c;
}

describe('creator surveys', () => {
  let app;
  before(async () => { app = await startApi({ webBaseUrl: 'http://web.local:3000' }); });
  after(() => app.close());

  test('creator endpoints require a Bearer token', async () => {
    for (const [method, path] of [['GET', '/surveys'], ['POST', '/surveys'], ['GET', '/surveys/1'], ['GET', '/surveys/1/export.csv'], ['GET', '/surveys/events']]) {
      const res = await new Client(app.base).request(path, { method });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json.error.code, 'unauthorized');
    }
  });

  test('create, read, list: field ids, status, closing date and the web share link', async () => {
    const c = await creator(app.base, 'crud@corp.local');
    const created = await c.request('/surveys', { method: 'POST', body: { title: ' Team ', description: 'Internal', fields: FIELDS } });
    assert.equal(created.status, 201);
    const survey = created.json.survey;
    assert.equal(survey.title, 'Team');
    assert.equal(survey.status, 'open');
    assert.equal(survey.isOpen, true);
    assert.equal(survey.responseCount, 0);
    assert.match(survey.closesOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(survey.shareUrl, `http://web.local:3000/s/${survey.publicToken}`);
    assert.deepEqual(survey.fields.map((f) => [f.label, f.type, f.required, f.options]), [
      ['Your name', 'text', true, []], ['Department', 'select', true, ['IT', 'HR']], ['Tools', 'checkbox', false, ['Mail', 'Chat']],
    ]);
    for (const f of survey.fields) assert.match(f.id, /^[a-z0-9]{4,32}$/);
    assert.match(survey.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const one = await c.request(`/surveys/${survey.id}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.json.survey, survey);

    const list = await c.request('/surveys');
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.surveys.map((s) => [s.id, s.title, s.status, s.responseCount, s.closesOn]), [[survey.id, 'Team', 'open', 0, survey.closesOn]]);
    assert.equal(list.json.surveys[0].fields, undefined, 'the list stays light');
  });

  test('creators cannot see or change surveys of other creators (404 not_found)', async () => {
    const owner = await creator(app.base, 'owner@corp.local');
    const { id } = await owner.createSurvey([{ label: 'Q', type: 'text' }]);
    const other = await creator(app.base, 'other@corp.local');
    const attempts = [
      ['GET', `/surveys/${id}`], ['PUT', `/surveys/${id}`, { title: 'x', fields: [{ label: 'Q', type: 'text' }] }],
      ['PATCH', `/surveys/${id}`, { isOpen: false }], ['DELETE', `/surveys/${id}`], ['GET', `/surveys/${id}/responses`],
      ['DELETE', `/surveys/${id}/responses/1`], ['GET', `/surveys/${id}/summary`], ['GET', `/surveys/${id}/export.csv`],
      ['GET', `/surveys/${id}/qr.svg`], ['GET', `/surveys/${id}/qr.png`], ['GET', `/surveys/${id}/events`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await other.request(path, { method, body });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal(res.json.error.code, 'not_found');
    }
    assert.deepEqual((await other.request('/surveys')).json.surveys, []);
    assert.equal((await owner.request(`/surveys/${id}`)).json.survey.isOpen, true);
    assert.equal((await owner.request('/surveys/abc')).status, 404);
  });

  test('invalid definitions give 422 with ordered error codes and params', async () => {
    const c = await creator(app.base, 'invalid@corp.local');
    const res = await c.request('/surveys', { method: 'POST', body: { title: '', fields: [] } });
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'validation_failed');
    assert.deepEqual(res.json.error.errors.map((e) => e.code), ['title_required', 'fields_empty']);
    assert.equal(res.json.error.errors[0].message, 'Title is required.');

    const long = await c.request('/surveys', { method: 'POST', body: { title: 'x'.repeat(201), fields: [{ label: 'Q', type: 'nope' }] } });
    assert.deepEqual(long.json.error.errors.map((e) => [e.code, e.params]), [['title_too_long', { max: 200 }], ['type_unknown', { n: 1 }]]);
    const notArray = await c.request('/surveys', { method: 'POST', body: { title: 'x', fields: 'nope' } });
    assert.deepEqual(notArray.json.error.errors.map((e) => e.code), ['fields_invalid']);
    assert.deepEqual((await c.request('/surveys')).json.surveys, [], 'nothing was stored');
  });

  test('repeated options or repeated questions are rejected', async () => {
    const c = await creator(app.base, 'dupes@corp.local');
    const res = await c.request('/surveys', {
      method: 'POST',
      body: { title: 'Dupes', fields: [{ label: 'Department', type: 'radio', options: ['IT', 'it'] }, { label: 'DEPARTMENT', type: 'text' }] },
    });
    assert.equal(res.status, 422);
    assert.deepEqual(res.json.error.errors.map((e) => [e.code, e.params]), [
      ['option_duplicate', { n: 1, option: 'IT' }], ['label_duplicate', { first: 1, second: 2 }],
    ]);
    assert.equal(res.json.error.errors[0].message, 'Field 1: the option "IT" is repeated. Each option must be different.');
  });

  test('editing keeps field ids so existing answers still match', async () => {
    const c = await creator(app.base, 'edit@corp.local');
    const survey = await c.createSurvey([{ label: 'Original', type: 'text' }]);
    const [field] = survey.fields;
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'kept answer' } })).status, 201);

    const fields = [{ ...field, label: 'Renamed' }, { label: 'New one', type: 'number' }];
    const saved = await c.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: 'Edited', description: '', closesOn: survey.closesOn, fields } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.survey.title, 'Edited');
    assert.equal(saved.json.survey.fields[0].id, field.id);
    assert.equal(saved.json.survey.fields[0].label, 'Renamed');
    const responses = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    assert.equal(responses[0].answers[field.id], 'kept answer');

    const bad = await c.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: '', fields } });
    assert.equal(bad.status, 422);
    assert.equal((await c.request(`/surveys/${survey.id}`)).json.survey.title, 'Edited');
  });

  test('open and close with PATCH, then delete', async () => {
    const c = await creator(app.base, 'toggle@corp.local');
    const { id } = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const closed = await c.request(`/surveys/${id}`, { method: 'PATCH', body: { isOpen: false } });
    assert.equal(closed.status, 200);
    assert.equal(closed.json.survey.isOpen, false);
    assert.equal(closed.json.survey.status, 'closed');
    const bad = await c.request(`/surveys/${id}`, { method: 'PATCH', body: { isOpen: 'no' } });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json.error.errors.map((e) => e.code), ['is_open_invalid']);
    assert.equal((await c.request(`/surveys/${id}`, { method: 'PATCH', body: { isOpen: true } })).json.survey.status, 'open');

    const del = await c.request(`/surveys/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    assert.equal((await c.request(`/surveys/${id}`)).status, 404);
  });

  test('responses are listed newest first and can be deleted one by one', async () => {
    const c = await creator(app.base, 'responses@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const [field] = survey.fields;
    await answer(app.base, survey.publicToken, { answers: { [field.id]: 'first' }, respondentName: ' Marta Gómez ' });
    await answer(app.base, survey.publicToken, { answers: { [field.id]: 'second' } });
    const list = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    assert.deepEqual(list.map((r) => [r.answers[field.id], r.respondentName]), [['second', null], ['first', 'Marta Gómez']]);
    assert.match(list[0].submittedAt, /Z$/);
    assert.equal((await c.request(`/surveys/${survey.id}`)).json.survey.responseCount, 2);

    const del = await c.request(`/surveys/${survey.id}/responses/${list[1].id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    assert.deepEqual((await c.request(`/surveys/${survey.id}/responses`)).json.responses.map((r) => r.id), [list[0].id]);
  });

  test('responses are numbered 1, 2, 3... per survey, not across the whole app', async () => {
    const c = await creator(app.base, 'numbers@corp.local');
    const a = await c.createSurvey([{ label: 'Q', type: 'text' }], 'A');
    const b = await c.createSurvey([{ label: 'Q', type: 'text' }], 'B');
    const sent = [];
    for (const survey of [a, b, a, b, a]) {
      const res = await answer(app.base, survey.publicToken);
      assert.equal(res.status, 201, res.text);
      sent.push([survey.title, res.json.number]);
    }
    assert.deepEqual(sent, [['A', 1], ['B', 1], ['A', 2], ['B', 2], ['A', 3]]);
    const list = async (survey) => (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    assert.deepEqual((await list(a)).map((r) => r.number), [3, 2, 1]);
    assert.deepEqual((await list(b)).map((r) => r.number), [2, 1]);
    // The global id stays the identifier: it differs from the number and is unique app-wide.
    const ids = [...(await list(a)), ...(await list(b))].map((r) => r.id);
    assert.equal(new Set(ids).size, 5);
  });

  test('a deleted response number is never reused', async () => {
    const c = await creator(app.base, 'reuse@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    for (let i = 0; i < 3; i++) await answer(app.base, survey.publicToken);
    const [third] = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    assert.equal(third.number, 3);
    assert.equal((await c.request(`/surveys/${survey.id}/responses/${third.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await answer(app.base, survey.publicToken)).json.number, 4);
    assert.deepEqual((await c.request(`/surveys/${survey.id}/responses`)).json.responses.map((r) => r.number), [4, 2, 1]);
  });

  test('a rejected submission does not use up a number', async () => {
    const c = await creator(app.base, 'rejected@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text', required: true }]);
    const [field] = survey.fields;
    const respondent = new Client(app.base, { deviceId: newDeviceId() });
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'one' } }, respondent)).json.number, 1);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'again' } }, respondent)).status, 409);
    assert.equal((await answer(app.base, survey.publicToken, { answers: {} })).status, 422);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'two' } })).json.number, 2);
  });

  test('concurrent submissions from different devices get distinct consecutive numbers', async () => {
    const c = await creator(app.base, 'concurrent@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const results = await Promise.all(Array.from({ length: 12 }, () => answer(app.base, survey.publicToken)));
    assert.deepEqual(results.map((r) => r.status), Array(12).fill(201));
    assert.deepEqual(results.map((r) => r.json.number).sort((x, y) => x - y), Array.from({ length: 12 }, (_, i) => i + 1));
  });

  test('the CSV first column holds the per-survey response numbers', async () => {
    const c = await creator(app.base, 'csvnumbers@corp.local');
    const other = await c.createSurvey([{ label: 'Q', type: 'text' }], 'Other');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }], 'Main');
    const [field] = survey.fields;
    await answer(app.base, other.publicToken);
    await answer(app.base, survey.publicToken, { answers: { [field.id]: 'first' } });
    await answer(app.base, other.publicToken);
    await answer(app.base, survey.publicToken, { answers: { [field.id]: 'second' } });
    const lines = (await c.request(`/surveys/${survey.id}/export.csv`, { raw: true })).text.slice(1).trim().split('\r\n');
    assert.deepEqual(lines.slice(1).map((l) => [l.split(',')[0], l.split(',').at(-1)]), [['1', 'first'], ['2', 'second']]);
  });

  test('CSV export: BOM, translated headers and yes/no, delimiter, formula neutralization', async () => {
    const c = await creator(app.base, 'csv@corp.local');
    const survey = await c.createSurvey([...FIELDS, { label: 'Remote?', type: 'yesno' }]);
    const [name, dept, tools, remote] = survey.fields.map((f) => f.id);
    await answer(app.base, survey.publicToken, { answers: { [name]: '=Luis, "Lu"', [dept]: 'HR', [tools]: ['Chat', 'Mail'], [remote]: 'yes' } });

    const csv = await c.request(`/surveys/${survey.id}/export.csv`, { raw: true });
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(csv.headers.get('content-disposition'), new RegExp(`attachment; filename="sharevy-survey-${survey.id}-responses.csv"`));
    assert.deepEqual([...csv.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const lines = csv.text.slice(1).split('\r\n');
    assert.equal(lines[0], 'Response #,Submitted at (UTC),Name,Your name,Department,Tools,Remote?');
    assert.match(lines[1], /,"'=Luis, ""Lu""",HR,"Mail, Chat",Yes$/);

    const es = await c.request(`/surveys/${survey.id}/export.csv?delimiter=semicolon&lang=es`, { raw: true });
    assert.equal(es.text.slice(1).split('\r\n')[0], 'N.º de respuesta;Enviada el (UTC);Nombre;Your name;Department;Tools;Remote?');
    assert.match(es.text, /;Sí\r\n$/);
    const negotiated = await c.request(`/surveys/${survey.id}/export.csv`, { raw: true, headers: { 'accept-language': 'es-MX' } });
    assert.match(negotiated.text, /^﻿N\.º de respuesta,/);

    const bad = await c.request(`/surveys/${survey.id}/export.csv?delimiter=tab`);
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'invalid_parameter');
    assert.deepEqual(bad.json.error.params, { name: 'delimiter' });
    assert.equal((await c.request(`/surveys/${survey.id}/export.csv?lang=fr`)).json.error.params.name, 'lang');
  });

  test('QR code of the share link as SVG and PNG', async () => {
    const c = await creator(app.base, 'qr@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const svg = await c.request(`/surveys/${survey.id}/qr.svg`, { raw: true });
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    const expected = (await QRCode.toString(survey.shareUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }))
      .trim().replace('<svg ', '<svg role="img" aria-label="QR code that opens this survey" ');
    assert.equal(svg.text, expected);

    const png = await c.request(`/surveys/${survey.id}/qr.png`, { raw: true });
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('content-disposition'), /attachment; filename="sharevy-survey-\d+-qr\.png"/);
    assert.deepEqual([...png.bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe('closing date', () => {
  let app;
  let now = new Date(2026, 10, 16, 12, 0); // Nov 16, 2026, server local time
  before(async () => { app = await startApi({ now: () => now }); });
  after(() => app.close());

  test('surveys close 10 days after creation by default and expire after the closing day', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const c = await creator(app.base, 'deadline@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    assert.equal(survey.closesOn, '2026-11-26');
    assert.equal((await c.request('/meta')).json.today, '2026-11-16');

    now = new Date(2026, 10, 26, 23, 59); // still open during the whole closing day
    assert.equal((await answer(app.base, survey.publicToken)).status, 201);

    now = new Date(2026, 10, 27, 0, 1);
    const late = await answer(app.base, survey.publicToken);
    assert.equal(late.status, 403);
    assert.equal(late.json.error.code, 'survey_expired');
    assert.deepEqual(late.json.error.params, { date: '2026-11-26' });
    assert.equal((await c.request('/surveys')).json.surveys[0].status, 'expired');
    assert.equal((await c.request(`/surveys/${survey.id}`)).json.survey.status, 'expired');
  });

  test('a past date is rejected unless it is unchanged; extending reopens an expired survey', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const c = await creator(app.base, 'extend@corp.local');
    const fields = [{ label: 'Q', type: 'text' }];
    const past = await c.request('/surveys', { method: 'POST', body: { title: 'Past', fields, closesOn: '2026-11-10' } });
    assert.equal(past.status, 422);
    assert.deepEqual(past.json.error.errors.map((e) => e.code), ['closing_date_past']);
    const invalid = await c.request('/surveys', { method: 'POST', body: { title: 'Bad', fields, closesOn: '2026-02-30' } });
    assert.deepEqual(invalid.json.error.errors.map((e) => e.code), ['closing_date_invalid']);

    const survey = await c.createSurvey(fields, 'Short', { closesOn: '2026-11-17' });
    now = new Date(2026, 10, 20, 9, 0);
    const same = await c.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: 'Renamed', fields: survey.fields, closesOn: '2026-11-17' } });
    assert.equal(same.status, 200, 'an unchanged past date is allowed');
    assert.equal(same.json.survey.status, 'expired');
    const other = await c.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: 'Renamed', fields: survey.fields, closesOn: '2026-11-18' } });
    assert.deepEqual(other.json.error.errors.map((e) => e.code), ['closing_date_past']);
    const extended = await c.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: 'Short', fields: survey.fields, closesOn: '2026-11-30' } });
    assert.equal(extended.json.survey.status, 'open');
    assert.equal((await answer(app.base, survey.publicToken)).status, 201);
  });
});

describe('summary: key figures and chart data', () => {
  let app;
  let now = new Date(2026, 10, 16, 12, 0);
  before(async () => { app = await startApi({ now: () => now }); });
  after(() => app.close());

  const CHART_FIELDS = [
    { label: 'Comment', type: 'text' },
    { label: 'Department', type: 'radio', options: ['Ops', 'Admin', 'HR'] },
    { label: 'Days', type: 'checkbox', options: ['Mon', 'Wed', 'Fri'] },
    { label: 'Remote', type: 'yesno' },
  ];

  test('counts per option, answered counts and KPIs computed by the server', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const c = await creator(app.base, 'charts@corp.local');
    const survey = await c.createSurvey(CHART_FIELDS);
    const [, dept, days, remote] = survey.fields.map((f) => f.id);
    await answer(app.base, survey.publicToken, { respondentName: 'Ana', answers: { [dept]: 'Ops', [days]: ['Mon', 'Fri'], [remote]: 'yes' } });
    await answer(app.base, survey.publicToken, { answers: { [dept]: 'HR', [days]: ['Fri'] } });
    await answer(app.base, survey.publicToken, { respondentName: 'Luis', answers: { [dept]: 'Ops' } });

    const res = await c.request(`/surveys/${survey.id}/summary`);
    assert.equal(res.status, 200);
    const { kpis, questions } = res.json;
    assert.equal(kpis.total, 3);
    assert.equal(kpis.named, 2);
    assert.equal(kpis.anonymous, 1);
    assert.match(kpis.lastResponseAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual({ status: kpis.status, closesOn: kpis.closesOn, daysLeft: kpis.daysLeft }, { status: 'open', closesOn: '2026-11-26', daysLeft: 10 });

    assert.deepEqual(questions.map((q) => [q.label, q.type, q.answered, q.multiple]), [
      ['Department', 'radio', 3, false], ['Days', 'checkbox', 2, true], ['Remote', 'yesno', 1, false],
    ]);
    assert.equal(questions[0].fieldId, dept);
    assert.deepEqual(questions[0].counts, [{ option: 'Ops', count: 2, percent: 67 }, { option: 'Admin', count: 0, percent: 0 }, { option: 'HR', count: 1, percent: 33 }]);
    assert.deepEqual(questions[1].counts.map((x) => [x.option, x.count, x.percent]), [['Mon', 1, 50], ['Wed', 0, 0], ['Fri', 2, 100]]);
    assert.deepEqual(questions[2].counts.map((x) => [x.option, x.count]), [['yes', 1], ['no', 0]]);

    now = new Date(2026, 10, 26, 9, 0);
    assert.equal((await c.request(`/surveys/${survey.id}/summary`)).json.kpis.daysLeft, 0, 'last day');
    now = new Date(2026, 10, 27, 9, 0);
    const expired = (await c.request(`/surveys/${survey.id}/summary`)).json.kpis;
    assert.deepEqual([expired.status, expired.daysLeft], ['expired', null]);
    now = new Date(2026, 10, 16, 12, 0);
    await c.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: false } });
    assert.equal((await c.request(`/surveys/${survey.id}/summary`)).json.kpis.status, 'closed');
  });

  test('an empty survey has zero totals and no last response', async () => {
    const c = await creator(app.base, 'kpi-empty@corp.local');
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const { kpis, questions } = (await c.request(`/surveys/${survey.id}/summary`)).json;
    assert.deepEqual([kpis.total, kpis.named, kpis.anonymous, kpis.lastResponseAt], [0, 0, 0, null]);
    assert.deepEqual(questions, []);
  });
});

describe('existing database', () => {
  test('a database from the first version opens with all its data, served by the API', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'sharevy-api-v1-'));
    // Runs after the server closed (finally below), so the database file is no longer open.
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE surveys (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_token TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', fields_json TEXT NOT NULL,
        is_open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE responses (id INTEGER PRIMARY KEY AUTOINCREMENT, survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        answers_json TEXT NOT NULL, submitted_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);
    old.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('old@corp.local', 'Old', await hashPassword('secret123'));
    old.prepare(`INSERT INTO surveys (owner_id, public_token, title, fields_json, created_at) VALUES (1, 'oldtoken', 'Old survey', ?, '2026-11-01 08:00:00')`)
      .run(JSON.stringify([{ id: 'q0000001', label: 'Q', type: 'text', required: false, options: [] }]));
    old.prepare(`INSERT INTO responses (survey_id, answers_json, submitted_at) VALUES (1, '{"q0000001":"old answer"}', '2026-11-02 09:30:00')`).run();
    old.close();

    const app = await startApi({}, { dbPath: path });
    try {
      const c = new Client(app.base);
      assert.equal((await c.login('old@corp.local')).status, 200);
      const [survey] = (await c.request('/surveys')).json.surveys;
      assert.deepEqual([survey.title, survey.responseCount, survey.closesOn, survey.publicToken], ['Old survey', 1, '2026-11-11', 'oldtoken']);
      const [response] = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
      assert.deepEqual([response.answers.q0000001, response.respondentName, response.submittedAt], ['old answer', null, '2026-11-02T09:30:00Z']);
      // Old responses have no device, so they never block a new device.
      assert.equal((await answer(app.base, 'oldtoken', {}, new Client(app.base, { deviceId: newDeviceId() }))).status, 403, 'expired by its migrated date');
    } finally {
      await app.close();
    }
  });
});

describe('share link address', () => {
  /** shareUrl of a new survey (and the URL its QR code encodes), with the given forwarded headers. */
  async function shareUrlWith(app, email, headers) {
    const c = await creator(app.base, email);
    const survey = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const got = await c.request(`/surveys/${survey.id}`, { headers });
    const svg = await c.request(`/surveys/${survey.id}/qr.svg`, { headers, raw: true });
    const qr = (await QRCode.toString(got.json.survey.shareUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })).trim();
    assert.equal(svg.text.replace(/ role="img" aria-label="[^"]*"/, ''), qr, 'the QR code encodes the same link');
    return got.json.survey.shareUrl.replace(`/s/${survey.publicToken}`, '');
  }
  const lan = { 'x-forwarded-host': '192.168.1.20:3000', 'x-forwarded-proto': 'http' };

  test('without WEB_BASE_URL, behind the trusted web proxy, links use the address the browser used', async () => {
    const app = await startApi({ trustProxy: true });
    try {
      assert.equal(await shareUrlWith(app, 'fwd1@corp.local', lan), 'http://192.168.1.20:3000');
      assert.equal(await shareUrlWith(app, 'fwd2@corp.local', { 'x-forwarded-host': 'surveys.corp.local', 'x-forwarded-proto': 'https' }), 'https://surveys.corp.local');
      // Anything that is not hostname[:port] (or a bad scheme) is ignored: the default address is used.
      for (const [i, bad] of [
        { 'x-forwarded-host': 'evil.example/phish', 'x-forwarded-proto': 'http' },
        { 'x-forwarded-host': 'a b', 'x-forwarded-proto': 'http' },
        { 'x-forwarded-host': 'lan.local', 'x-forwarded-proto': 'javascript' },
      ].entries()) {
        assert.equal(await shareUrlWith(app, `bad${i}@corp.local`, bad), 'http://localhost:3000', JSON.stringify(bad));
      }
      assert.equal(await shareUrlWith(app, 'none@corp.local', {}), 'http://localhost:3000');
    } finally {
      await app.close();
    }
  });

  test('forwarded headers are ignored when the proxy is not trusted, and WEB_BASE_URL always wins', async () => {
    const untrusted = await startApi({ trustProxy: false });
    const pinned = await startApi({ trustProxy: true, webBaseUrl: 'http://pinned.local:3000' });
    try {
      assert.equal(await shareUrlWith(untrusted, 'untrusted@corp.local', lan), 'http://localhost:3000');
      assert.equal(await shareUrlWith(pinned, 'pinned@corp.local', lan), 'http://pinned.local:3000');
    } finally {
      await untrusted.close();
      await pinned.close();
    }
  });
});
