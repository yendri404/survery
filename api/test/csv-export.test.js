import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { attachmentDisposition } from '../src/http.js';
import { csvDelimiterFor, fileSafeName } from '../src/surveys.js';
import { Client, answer, startApi } from './helpers.js';

test('fileSafeName keeps the survey title readable and drops what file systems refuse', () => {
  assert.equal(fileSafeName('Clima laboral 2026 (demo, abierta)', 'survey-7'), 'Clima laboral 2026 (demo, abierta)');
  assert.equal(fileSafeName('  Q1: "ventas" / compras?  ', 'survey-7'), 'Q1 ventas compras');
  assert.equal(fileSafeName('a\u0000b\tc\r\nd', 'survey-7'), 'ab c d');
  assert.equal(fileSafeName('...', 'survey-7'), 'survey-7');
  assert.equal(fileSafeName('x'.repeat(300), 'survey-7').length, 100);
});

test('attachmentDisposition sends an ASCII name plus the exact UTF-8 one (RFC 6266 / 5987)', () => {
  assert.equal(attachmentDisposition('Encuesta año.csv'),
    "attachment; filename=\"Encuesta ano.csv\"; filename*=UTF-8''Encuesta%20a%C3%B1o.csv");
  assert.equal(attachmentDisposition('Lunch (team).csv'),
    "attachment; filename=\"Lunch (team).csv\"; filename*=UTF-8''Lunch%20%28team%29.csv");
});

test('csvDelimiterFor: semicolon only when a number answer has decimals', () => {
  const fields = [{ id: 'n1', type: 'number' }, { id: 't1', type: 'text' }, { id: 's1', type: 'scale', min: 1, max: 5 }];
  const rows = (...answers) => answers.map((a, i) => ({ id: i + 1, answers: a }));
  assert.equal(csvDelimiterFor(fields, rows({ n1: '3', t1: '2.5', s1: '4' })), ',');
  assert.equal(csvDelimiterFor(fields, rows({ n1: '3' }, { n1: '-0.75' })), ';');
  assert.equal(csvDelimiterFor(fields, rows({ n1: '10.0' })), ','); // a whole number written with .0
  assert.equal(csvDelimiterFor(fields, []), ',');
});

describe('CSV export over HTTP', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('delimiter=auto picks the delimiter from the answers; the file is named after the survey', async () => {
    const c = new Client(app.base);
    assert.equal((await c.register('csvname@corp.local')).status, 201);
    const survey = await c.createSurvey([{ label: 'Years', type: 'number' }], 'Clima laboral año 2026');
    const [years] = survey.fields.map((f) => f.id);

    await answer(app.base, survey.publicToken, { answers: { [years]: '4' } });
    const whole = await c.request(`/surveys/${survey.id}/export.csv?delimiter=auto`, { raw: true });
    assert.equal(whole.status, 200);
    assert.match(whole.text.slice(1).split('\r\n')[0], /^Response #,Submitted at \(UTC\),Name,Years$/);
    assert.equal(whole.headers.get('content-disposition'),
      "attachment; filename=\"Clima laboral ano 2026.csv\"; filename*=UTF-8''Clima%20laboral%20a%C3%B1o%202026.csv");

    await answer(app.base, survey.publicToken, { answers: { [years]: '2.5' } });
    const decimals = await c.request(`/surveys/${survey.id}/export.csv?delimiter=auto`, { raw: true });
    assert.match(decimals.text.slice(1).split('\r\n')[0], /^Response #;Submitted at \(UTC\);Name;Years$/);

    // Explicit delimiters and the default (comma) keep working for other clients.
    assert.match((await c.request(`/surveys/${survey.id}/export.csv`, { raw: true })).text, /^.Response #,/);
    assert.match((await c.request(`/surveys/${survey.id}/export.csv?delimiter=semicolon`, { raw: true })).text, /^.Response #;/);
    assert.equal((await c.request(`/surveys/${survey.id}/export.csv?delimiter=tab`)).status, 400);
  });
});
