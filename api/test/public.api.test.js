import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { hashToken } from '../src/auth.js';
import { Client, answer, newDeviceId, openEvents, startApi } from './helpers.js';

async function surveyOf(base, email, fields = [{ label: 'Q', type: 'text' }]) {
  const c = new Client(base);
  assert.equal((await c.register(email)).status, 201);
  return { c, survey: await c.createSurvey(fields) };
}

const device = (base) => new Client(base, { deviceId: newDeviceId() });

describe('respondents', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('a survey is read by its public token without an account', async () => {
    const { survey } = await surveyOf(app.base, 'read@corp.local', [{ label: 'Pick', type: 'radio', options: ['A', 'B'], required: true }]);
    const res = await device(app.base).request(`/public/surveys/${survey.publicToken}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.survey).sort(), ['alreadyAnswered', 'closesOn', 'description', 'fields', 'status', 'title']);
    assert.equal(res.json.survey.status, 'open');
    assert.equal(res.json.survey.alreadyAnswered, false);
    assert.deepEqual(res.json.survey.fields, survey.fields);

    const missing = await device(app.base).request('/public/surveys/no-such-token');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not_found');
    assert.equal(missing.json.error.message, 'This survey does not exist. Check the link you received.');
  });

  test('server-side validation returns per-field codes; a valid answer is stored as sent', async () => {
    const { c, survey } = await surveyOf(app.base, 'flow@corp.local', [
      { label: 'Your name', type: 'text', required: true },
      { label: 'Department', type: 'select', required: true, options: ['IT', 'HR'] },
      { label: 'Tools', type: 'checkbox', options: ['Mail', 'Chat'] },
      { label: 'Age', type: 'number' },
      { label: 'Mail', type: 'email' },
      { label: 'When', type: 'date' },
    ]);
    const [name, dept, tools, age, mail, when] = survey.fields.map((f) => f.id);
    const respondent = device(app.base);
    const invalid = await answer(app.base, survey.publicToken, {
      answers: { [dept]: 'Sales', [tools]: ['Fax'], [age]: 'abc', [mail]: 'nope', [when]: '2026-02-30' },
      respondentName: 'a'.repeat(101),
    }, respondent);
    assert.equal(invalid.status, 422);
    assert.equal(invalid.json.error.code, 'validation_failed');
    const codes = Object.fromEntries(Object.entries(invalid.json.error.fields).map(([k, v]) => [k, v.code]));
    assert.deepEqual(codes, {
      [name]: 'required', [dept]: 'invalid_option', [tools]: 'invalid_option', [age]: 'invalid_number',
      [mail]: 'invalid_email', [when]: 'invalid_date', respondentName: 'respondent_name_too_long',
    });
    assert.deepEqual(invalid.json.error.fields.respondentName.params, { max: 100 });
    assert.equal((await c.request(`/surveys/${survey.id}/responses`)).json.responses.length, 0);

    const ok = await answer(app.base, survey.publicToken, {
      answers: { [name]: ' Luis ', [dept]: 'HR', [tools]: ['Chat', 'Mail'], [age]: '42', unknown: 'ignored' },
    }, respondent);
    assert.equal(ok.status, 201);
    assert.equal(typeof ok.json.id, 'number');
    const [stored] = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    assert.deepEqual(stored.answers, { [name]: 'Luis', [dept]: 'HR', [tools]: ['Mail', 'Chat'], [age]: '42', [mail]: '', [when]: '' });

    const notObject = await answer(app.base, survey.publicToken, { answers: ['x'] });
    assert.equal(notObject.status, 422);
    assert.deepEqual(notObject.json.error.errors.map((e) => e.code), ['answers_invalid']);
  });

  test('the respondent name is optional and trimmed', async () => {
    const { c, survey } = await surveyOf(app.base, 'names@corp.local');
    const [field] = survey.fields;
    assert.equal((await answer(app.base, survey.publicToken, { respondentName: '  Marta Gómez ', answers: { [field.id]: 'x' } })).status, 201);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'y' } })).status, 201);
    const names = (await c.request(`/surveys/${survey.id}/responses`)).json.responses.map((r) => r.respondentName);
    assert.deepEqual(names, [null, 'Marta Gómez']);
  });

  test('yes/no accepts only the canonical values yes and no', async () => {
    const { survey } = await surveyOf(app.base, 'yesno@corp.local', [{ label: 'Remote?', type: 'yesno', required: true }]);
    const [field] = survey.fields;
    assert.deepEqual(field.options, []);
    assert.equal((await answer(app.base, survey.publicToken)).json.error.fields[field.id].code, 'required');
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'Sí' } })).json.error.fields[field.id].code, 'invalid_option');
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [field.id]: 'no' } })).status, 201);
  });

  test('each device answers a survey once; only the hash of X-Device-Id is stored', async () => {
    const { c, survey } = await surveyOf(app.base, 'once@corp.local');
    const phone = device(app.base);
    assert.equal((await answer(app.base, survey.publicToken, {}, phone)).status, 201);
    const again = await answer(app.base, survey.publicToken, {}, phone);
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'already_answered');
    assert.equal((await phone.request(`/public/surveys/${survey.publicToken}`)).json.survey.alreadyAnswered, true);
    const hashes = app.db.prepare('SELECT device_hash FROM responses WHERE survey_id = ?').all(survey.id).map((r) => r.device_hash);
    assert.deepEqual(hashes, [hashToken(phone.deviceId)]);

    assert.equal((await answer(app.base, survey.publicToken)).status, 201, 'another device can answer');
    const second = await c.createSurvey([{ label: 'Q2', type: 'text' }], 'Second');
    assert.equal((await answer(app.base, second.publicToken, {}, phone)).status, 201, 'the same device can answer other surveys');
  });

  test('a malformed X-Device-Id is rejected; without one the server issues a device id', async () => {
    const { c, survey } = await surveyOf(app.base, 'device@corp.local');
    const bad = await answer(app.base, survey.publicToken, {}, new Client(app.base, { deviceId: 'short' }));
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'invalid_device_id');
    assert.equal((await new Client(app.base, { deviceId: 'bad id with spaces!!!!' }).request(`/public/surveys/${survey.publicToken}`)).status, 400);

    const anonymous = new Client(app.base);
    const first = await answer(app.base, survey.publicToken, {}, anonymous);
    assert.equal(first.status, 201);
    assert.match(first.json.deviceId, /^[A-Za-z0-9_-]{20,100}$/);
    anonymous.deviceId = first.json.deviceId;
    assert.equal((await answer(app.base, survey.publicToken, {}, anonymous)).status, 409);
    const sent = await answer(app.base, (await c.createSurvey([{ label: 'Q', type: 'text' }], 'Other')).publicToken, {}, anonymous);
    assert.equal(sent.json.deviceId, undefined, 'a device id the client sent is never echoed');
  });

  test('simultaneous submissions from one device store a single response', async () => {
    const { c, survey } = await surveyOf(app.base, 'race@corp.local');
    const phone = device(app.base);
    const statuses = (await Promise.all([1, 2, 3].map(() => answer(app.base, survey.publicToken, {}, phone)))).map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);
    assert.equal((await c.request(`/surveys/${survey.id}`)).json.survey.responseCount, 1);
  });

  test('a survey deleted while its answer is being sent answers 404 not_found and stores nothing', async () => {
    const { c, survey } = await surveyOf(app.base, 'gone@corp.local');
    const { port } = new URL(app.base);
    const body = JSON.stringify({ answers: { [survey.fields[0].id]: 'late' } });
    let resolveRes;
    const response = new Promise((resolve) => { resolveRes = resolve; });
    const req = request({
      host: '127.0.0.1', port, method: 'POST', path: `/api/v1/public/surveys/${survey.publicToken}/responses`,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-device-id': newDeviceId() },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolveRes({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.write(body.slice(0, 5)); // the API has found the survey and is reading the body
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await c.request(`/surveys/${survey.id}`, { method: 'DELETE' })).status, 204);
    req.end(body.slice(5));
    const res = await response;
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'not_found');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM responses WHERE survey_id = ?').get(survey.id).n, 0);
    // The transaction was rolled back: the API keeps writing normally.
    const next = await surveyOf(app.base, 'after-gone@corp.local');
    assert.equal((await answer(app.base, next.survey.publicToken, { answers: { [next.survey.fields[0].id]: 'ok' } })).status, 201);
  });

  test('closed surveys reject responses with 403 survey_closed until reopened', async () => {
    const { c, survey } = await surveyOf(app.base, 'close@corp.local');
    await c.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: false } });
    assert.equal((await device(app.base).request(`/public/surveys/${survey.publicToken}`)).json.survey.status, 'closed');
    const post = await answer(app.base, survey.publicToken);
    assert.equal(post.status, 403);
    assert.equal(post.json.error.code, 'survey_closed');
    await c.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: true } });
    assert.equal((await answer(app.base, survey.publicToken)).status, 201);
  });
});

describe('live updates', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('creators get change events on the survey and list streams', async () => {
    const { c, survey } = await surveyOf(app.base, 'live@corp.local');
    const surveyStream = await openEvents(`${app.base}/api/v1/surveys/${survey.id}/events`, c.token);
    const listStream = await openEvents(`${app.base}/api/v1/surveys/events`, c.token);
    try {
      assert.equal(surveyStream.res.status, 200);
      assert.match(surveyStream.res.headers.get('content-type'), /^text\/event-stream/);
      await surveyStream.waitFor(/: connected/);
      await listStream.waitFor(/: connected/);

      assert.equal((await answer(app.base, survey.publicToken)).status, 201);
      await surveyStream.waitFor(/event: change\ndata: /);
      await listStream.waitFor(/event: change\ndata: /);

      const [response] = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
      await c.request(`/surveys/${survey.id}/responses/${response.id}`, { method: 'DELETE' });
      await surveyStream.waitFor(/event: change/);
      await c.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: false } });
      await surveyStream.waitFor(/event: change/);
      await c.createSurvey([{ label: 'Q', type: 'text' }], 'Another');
      await listStream.waitFor(/event: change/);
    } finally {
      surveyStream.close();
      listStream.close();
    }
  });

  test('streams are private: Bearer only, owner only, never a token in the URL', async () => {
    const { c: owner, survey } = await surveyOf(app.base, 'live-owner@corp.local');
    const { c: other } = await surveyOf(app.base, 'live-other@corp.local');
    const foreign = await other.request(`/surveys/${survey.id}/events`);
    assert.equal(foreign.status, 404);
    assert.equal((await new Client(app.base).request(`/surveys/${survey.id}/events`)).status, 401);
    assert.equal((await fetch(`${app.base}/api/v1/surveys/events?token=${owner.token}`)).status, 401);

    const otherList = await openEvents(`${app.base}/api/v1/surveys/events`, other.token);
    try {
      await otherList.waitFor(/: connected/);
      await answer(app.base, survey.publicToken);
      await assert.rejects(otherList.waitFor(/event: change/, 300), /timed out/);
    } finally {
      otherList.close();
    }
  });
});

describe('submission rate limiting', () => {
  let app;
  before(async () => { app = await startApi({ submissionLimit: 2 }); });
  after(() => app.close());

  test('anonymous submissions are limited per survey and IP', async () => {
    const { c, survey } = await surveyOf(app.base, 'flood@corp.local');
    assert.equal((await answer(app.base, survey.publicToken)).status, 201);
    assert.equal((await answer(app.base, survey.publicToken)).status, 201);
    const blocked = await answer(app.base, survey.publicToken);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'too_many_responses');
    assert.equal(blocked.json.error.params.minutes, 10);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await c.request(`/surveys/${survey.id}`)).json.survey.responseCount, 2);
  });
});
