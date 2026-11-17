import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, answer, startApi } from './helpers.js';

async function creator(base, email) {
  const c = new Client(base);
  assert.equal((await c.register(email)).status, 201);
  return c;
}

describe('scale (slider) questions', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('meta lists the scale type and its limits', async () => {
    const meta = (await new Client(app.base).request('/meta')).json;
    assert.ok(meta.fieldTypes.includes('scale'));
    assert.deepEqual(meta.scale, { defaultMin: 1, defaultMax: 10, lowest: -1000, highest: 1000, maxSteps: 100 });
  });

  test('create and update keep the range (1-10 by default) and ids; other types drop min/max', async () => {
    const c = await creator(app.base, 'scale-crud@corp.local');
    const survey = await c.createSurvey([
      { label: 'Mood', type: 'scale', min: 1, max: 5 },
      { label: 'Default', type: 'scale' },
      { label: 'Age', type: 'number', min: 1, max: 5 },
    ]);
    assert.deepEqual(survey.fields.map(({ type, min, max }) => [type, min, max]), [['scale', 1, 5], ['scale', 1, 10], ['number', undefined, undefined]]);

    const fields = survey.fields.map((f, i) => (i === 0 ? { ...f, min: 0, max: 100 } : f));
    const updated = await c.request(`/surveys/${survey.id}`, { method: 'PUT', body: { title: 'T', fields } });
    assert.equal(updated.status, 200, updated.text);
    assert.deepEqual(updated.json.survey.fields.map((f) => [f.id, f.min, f.max]), survey.fields.map((f, i) => [f.id, i === 0 ? 0 : f.min, i === 0 ? 100 : f.max]));
  });

  test('invalid ranges give 422 with stable codes and params', async () => {
    const c = await creator(app.base, 'scale-invalid@corp.local');
    const res = await c.request('/surveys', { method: 'POST', body: { title: 'T', fields: [
      { label: 'A', type: 'scale', min: 1.5, max: 5 },
      { label: 'B', type: 'scale', min: 5, max: 1 },
      { label: 'C', type: 'scale', min: -100, max: 1 },
      { label: 'D', type: 'scale', min: 0, max: 2000 },
    ] } });
    assert.equal(res.status, 422);
    assert.deepEqual(res.json.error.errors.map((e) => [e.code, e.params]), [
      ['scale_bound_invalid', { n: 1, lowest: -1000, highest: 1000 }],
      ['scale_order', { n: 2 }],
      ['scale_too_wide', { n: 3, maxSteps: 100 }],
      ['scale_bound_invalid', { n: 4, lowest: -1000, highest: 1000 }],
    ]);
  });

  test('answers: in range, out of range, not whole, empty optional and empty required', async () => {
    const c = await creator(app.base, 'scale-answers@corp.local');
    const survey = await c.createSurvey([{ label: 'Mood', type: 'scale', min: 1, max: 5, required: true }, { label: 'Extra', type: 'scale' }]);
    const [mood, extra] = survey.fields.map((f) => f.id);
    for (const [value, code] of [[6, 'invalid_scale_value'], ['2.5', 'invalid_scale_value'], ['', 'required']]) {
      const res = await answer(app.base, survey.publicToken, { answers: { [mood]: value } });
      assert.equal(res.status, 422, String(value));
      assert.equal(res.json.error.fields[mood].code, code);
      if (code === 'invalid_scale_value') assert.deepEqual(res.json.error.fields[mood].params, { min: 1, max: 5 });
    }
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [mood]: 4 } })).status, 201);
    assert.equal((await answer(app.base, survey.publicToken, { answers: { [mood]: '2', [extra]: '10' } })).status, 201);
    const responses = (await c.request(`/surveys/${survey.id}/responses`)).json.responses;
    assert.deepEqual(responses.map((r) => r.answers), [{ [mood]: '2', [extra]: '10' }, { [mood]: '4', [extra]: '' }]);

    const csv = (await c.request(`/surveys/${survey.id}/export.csv`, { raw: true })).text.slice(1).trim().split('\r\n');
    assert.deepEqual(csv.slice(1).map((l) => l.split(',').slice(-2)), [['4', ''], ['2', '10']]);
  });

  test('summary: a count for every value of the range, the average and the median', async () => {
    const c = await creator(app.base, 'scale-summary@corp.local');
    const survey = await c.createSurvey([{ label: 'Mood', type: 'scale', min: 1, max: 5 }]);
    const [mood] = survey.fields.map((f) => f.id);
    for (const v of [5, 1, 5, 2]) await answer(app.base, survey.publicToken, { answers: { [mood]: v } });
    await answer(app.base, survey.publicToken, { answers: {} });
    const [q] = (await c.request(`/surveys/${survey.id}/summary`)).json.questions;
    assert.deepEqual({ ...q, counts: undefined }, {
      fieldId: mood, label: 'Mood', type: 'scale', multiple: false, answered: 4, counts: undefined,
      scale: { min: 1, max: 5, average: 3.3, median: 3.5, outOfRange: 0 },
    });
    assert.deepEqual(q.counts.map((x) => [x.option, x.count, x.percent]), [['1', 1, 25], ['2', 1, 25], ['3', 0, 0], ['4', 0, 0], ['5', 2, 50]]);
  });
});
