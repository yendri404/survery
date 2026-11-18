import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, answer, openEvents, startApi } from './helpers.js';

const FIELDS = [
  { label: 'Department', type: 'radio', required: true, options: ['IT', 'HR'] },
  { label: 'Comment', type: 'text' },
];

async function creator(base, email) {
  const c = new Client(base);
  assert.equal((await c.register(email)).status, 201);
  return c;
}

const setPublic = (c, id, publicResults) => c.request(`/surveys/${id}`, { method: 'PATCH', body: { publicResults } });
/** A client without any account or device: what a person with the results link has. */
const visitor = (base) => new Client(base);
const tokenOf = (resultsUrl) => resultsUrl.split('/r/')[1];

describe('public results', () => {
  let app;
  before(async () => { app = await startApi({ webBaseUrl: 'http://web.local:3000' }); });
  after(() => app.close());

  test('results are private by default: no results link', async () => {
    const c = await creator(app.base, 'private@corp.local');
    const survey = await c.createSurvey(FIELDS);
    assert.equal(survey.publicResults, false);
    assert.equal(survey.resultsUrl, null);
    const [listed] = (await c.request('/surveys')).json.surveys;
    assert.deepEqual([listed.publicResults, listed.resultsUrl], [false, null]);
  });

  test('turning results public gives a /r/ link; anyone reads the same results as the creator, names included', async () => {
    const c = await creator(app.base, 'public@corp.local');
    const survey = await c.createSurvey(FIELDS);
    const [dept, comment] = survey.fields.map((f) => f.id);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [dept]: 'IT', [comment]: 'Fine' }, respondentName: 'Ana' })).status, 201);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [dept]: 'HR' } })).status, 201);

    const on = await setPublic(c, survey.id, true);
    assert.equal(on.status, 200);
    assert.equal(on.json.survey.publicResults, true);
    assert.match(on.json.survey.resultsUrl, /^http:\/\/web\.local:3000\/r\/[A-Za-z0-9_-]{24}$/);
    assert.equal(on.json.survey.isOpen, true, 'publicResults alone leaves isOpen unchanged');
    assert.deepEqual((await c.request(`/surveys/${survey.id}`)).json.survey, on.json.survey);
    const token = tokenOf(on.json.survey.resultsUrl);
    assert.notEqual(token, survey.publicToken);

    const info = await visitor(app.base).request(`/public/results/${token}`);
    assert.equal(info.status, 200);
    assert.deepEqual(Object.keys(info.json.survey).sort(), ['closesOn', 'description', 'fields', 'requireName', 'status', 'title']);
    assert.equal(info.json.survey.title, 'Workplace survey');
    assert.deepEqual(info.json.survey.fields, survey.fields);
    assert.doesNotMatch(info.text, new RegExp(survey.publicToken), 'never the answer token');
    assert.doesNotMatch(info.text, /public@corp\.local|shareUrl|ownerId/, 'nothing about the owner or the share link');

    const summary = await visitor(app.base).request(`/public/results/${token}/summary`);
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.json, (await c.request(`/surveys/${survey.id}/summary`)).json);
    assert.equal(summary.json.kpis.total, 2);

    const responses = await visitor(app.base).request(`/public/results/${token}/responses`);
    assert.equal(responses.status, 200);
    assert.deepEqual(responses.json, (await c.request(`/surveys/${survey.id}/responses`)).json);
    assert.deepEqual(responses.json.responses.map((r) => r.respondentName), [null, 'Ana']);

    // Turning it on again keeps the same link.
    assert.equal((await setPublic(c, survey.id, true)).json.survey.resultsUrl, on.json.survey.resultsUrl);
  });

  test('turning results private kills the link for good; turning them public again makes a new one', async () => {
    const c = await creator(app.base, 'revoke@corp.local');
    const survey = await c.createSurvey(FIELDS);
    const first = tokenOf((await setPublic(c, survey.id, true)).json.survey.resultsUrl);

    const off = await setPublic(c, survey.id, false);
    assert.equal(off.status, 200);
    assert.deepEqual([off.json.survey.publicResults, off.json.survey.resultsUrl], [false, null]);
    for (const path of ['', '/summary', '/responses', '/events']) {
      const res = await visitor(app.base).request(`/public/results/${first}${path}`);
      assert.equal(res.status, 404, path);
      assert.equal(res.json.error.code, 'not_found');
      assert.equal(res.json.error.message, 'These results are not public.');
    }

    const second = tokenOf((await setPublic(c, survey.id, true)).json.survey.resultsUrl);
    assert.notEqual(second, first);
    assert.equal((await visitor(app.base).request(`/public/results/${first}`)).status, 404, 'the old link never comes back');
    assert.equal((await visitor(app.base).request(`/public/results/${second}`)).status, 200);
    assert.equal((await visitor(app.base).request('/public/results/no-such-token/summary')).status, 404);
  });

  test('only the owner can change it; a non-boolean is rejected; a PATCH without it leaves it as it was', async () => {
    const owner = await creator(app.base, 'own@corp.local');
    const survey = await owner.createSurvey(FIELDS);
    const other = await creator(app.base, 'notown@corp.local');
    const denied = await setPublic(other, survey.id, true);
    assert.equal(denied.status, 404);
    assert.equal(denied.json.error.code, 'not_found');
    assert.equal(denied.json.error.message, 'Survey not found.');
    assert.equal((await setPublic(visitor(app.base), survey.id, true)).status, 401);

    for (const bad of ['yes', 1, null]) {
      const res = await setPublic(owner, survey.id, bad);
      assert.equal(res.status, 422, JSON.stringify(bad));
      assert.deepEqual(res.json.error.errors.map((e) => e.code), ['public_results_invalid']);
    }
    // Both fields at once are checked and applied together.
    const both = await owner.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: 'no', publicResults: 'no' } });
    assert.deepEqual(both.json.error.errors.map((e) => e.code), ['is_open_invalid', 'public_results_invalid']);
    // An empty body still needs isOpen, as before.
    const empty = await owner.request(`/surveys/${survey.id}`, { method: 'PATCH', body: {} });
    assert.equal(empty.status, 422);
    assert.deepEqual(empty.json.error.errors.map((e) => e.code), ['is_open_invalid']);
    assert.equal((await owner.request(`/surveys/${survey.id}`)).json.survey.publicResults, false);

    const url = (await setPublic(owner, survey.id, true)).json.survey.resultsUrl;
    const closed = await owner.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: false } });
    assert.equal(closed.status, 200);
    assert.deepEqual([closed.json.survey.isOpen, closed.json.survey.publicResults, closed.json.survey.resultsUrl], [false, true, url]);
    const together = await owner.request(`/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: true, publicResults: false } });
    assert.deepEqual([together.json.survey.isOpen, together.json.survey.publicResults], [true, false]);
    // Editing the definition does not touch it either.
    await setPublic(owner, survey.id, true);
    const edited = await owner.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: 'Edited', fields: survey.fields } });
    assert.equal(edited.json.survey.publicResults, true);
  });

  test('the public results are read-only', async () => {
    const c = await creator(app.base, 'readonly@corp.local');
    const survey = await c.createSurvey(FIELDS);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [survey.fields[0].id]: 'IT' } })).status, 201);
    const token = tokenOf((await setPublic(c, survey.id, true)).json.survey.resultsUrl);
    const [{ id: responseId }] = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    for (const [method, path] of [
      ['DELETE', ''], ['PUT', ''], ['PATCH', ''], ['POST', '/responses'], ['DELETE', `/responses/${responseId}`],
      ['GET', '/export.csv'], ['GET', '/qr.svg'],
    ]) {
      const res = await visitor(app.base).request(`/public/results/${token}${path}`, { method, body: method === 'GET' || method === 'DELETE' ? undefined : {} });
      assert.ok([404, 405].includes(res.status), `${method} ${path}: ${res.status}`);
    }
    assert.equal((await c.request(`/surveys/${survey.id}/responses`)).json.responses.length, 1);
    assert.equal((await c.request(`/surveys/${survey.id}`)).json.survey.title, 'Workplace survey');
  });

  test('the public event stream follows the survey and refuses a revoked link', async () => {
    const c = await creator(app.base, 'stream@corp.local');
    const survey = await c.createSurvey(FIELDS);
    const token = tokenOf((await setPublic(c, survey.id, true)).json.survey.resultsUrl);
    const events = await openEvents(`${app.base}/api/v1/public/results/${token}/events`);
    try {
      assert.equal(events.res.status, 200);
      assert.match(events.res.headers.get('content-type'), /text\/event-stream/);
      await events.waitFor(/connected/);
      assert.equal((await answer(app.base, survey.publicToken, { answers: { [survey.fields[0].id]: 'HR' } })).status, 201);
      await events.waitFor(/event: change/);
      // Turning it off is a change too, so open public pages notice at once; then the server ends
      // the stream, so a revoked link no longer learns when the survey changes.
      await setPublic(c, survey.id, false);
      await events.waitFor(/event: change/);
      assert.equal(await events.ended(), true, 'the stream of a revoked link must end');
    } finally {
      events.close();
    }
    const revoked = await openEvents(`${app.base}/api/v1/public/results/${token}/events`);
    try {
      assert.equal(revoked.res.status, 404);
    } finally {
      revoked.close();
    }
  });
});
