import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client, startApi } from './helpers.js';

const FIELDS = [
  { label: 'Department', type: 'radio', required: true, options: ['IT', 'HR'] },
  { label: 'Score', type: 'scale', min: 1, max: 5 },
  { label: 'Comments', type: 'textarea' },
];

async function creator(base, email) {
  const c = new Client(base);
  assert.equal((await c.register(email)).status, 201);
  return c;
}
const exportTemplate = (c, id) => c.request(`/surveys/${id}/template`);
const check = (c, body) => c.request('/templates/check', { method: 'POST', body });

describe('survey templates: signed export, verified import', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('export: a signed file with the definition only, named after the survey; owner only', async () => {
    const c = await creator(app.base, 'tpl@corp.local');
    const survey = await c.createSurvey(FIELDS, 'Clima: 2026?', { requireName: true });
    const res = await exportTemplate(c, survey.id);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.match(res.headers.get('content-disposition'), /filename="Clima 2026.sharevy.json"/);
    const { signature, ...content } = res.json;
    assert.deepEqual(content, {
      format: 'sharevy-survey-template',
      version: 1,
      title: 'Clima: 2026?',
      description: 'Internal',
      requireName: true,
      fields: [
        { label: 'Department', type: 'radio', required: true, options: ['IT', 'HR'] },
        { label: 'Score', type: 'scale', required: false, min: 1, max: 5 },
        { label: 'Comments', type: 'textarea', required: false },
      ],
    });
    assert.match(signature, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!res.text.includes(survey.publicToken), 'no links');
    assert.equal((await exportTemplate(await creator(app.base, 'other-tpl@corp.local'), survey.id)).status, 404);
    assert.equal((await exportTemplate(new Client(app.base), survey.id)).status, 401);
  });

  test('import check: the exported file is accepted as is and gives back its content', async () => {
    const c = await creator(app.base, 'roundtrip@corp.local');
    const file = (await exportTemplate(c, (await c.createSurvey(FIELDS)).id)).json;
    const res = await check(c, file);
    assert.equal(res.status, 200, res.text);
    const { signature, ...content } = file;
    assert.deepEqual(res.json, { template: content });
    assert.equal((await check(new Client(app.base), file)).status, 401, 'needs an account');
  });

  test('anything not exported by this Sharevy is "unsupported": edited, hand-made, extra keys, no signature', async () => {
    const c = await creator(app.base, 'tamper@corp.local');
    const file = (await exportTemplate(c, (await c.createSurvey(FIELDS)).id)).json;
    const unsupported = async (body, why) => {
      const res = await check(c, body);
      assert.equal(res.status, 422, `${why}: ${res.status} ${res.text}`);
      assert.equal(res.json.error.code, 'template_unsupported', why);
    };
    await unsupported({ ...file, title: 'Changed' }, 'title edited');
    await unsupported({ ...file, fields: [{ ...file.fields[0], label: 'Changed' }, ...file.fields.slice(1)] }, 'question edited');
    await unsupported({ ...file, fields: file.fields.slice(1) }, 'question removed');
    await unsupported({ ...file, extra: '<script>alert(1)</script>' }, 'extra top-level key');
    await unsupported({ ...file, fields: [{ ...file.fields[0], onload: 'x' }, ...file.fields.slice(1)] }, 'extra field key');
    const { signature, ...unsigned } = file;
    await unsupported(unsigned, 'no signature');
    await unsupported({ ...file, signature: 'A'.repeat(43) }, 'made-up signature');
    await unsupported({ ...file, signature: 123 }, 'signature not text');
    await unsupported({ ...file, version: 2 }, 'other version');
    await unsupported({ title: 'x' }, 'not a template at all');
  });
});

describe('survey templates: the signing key', () => {
  test('templates from another instance are unsupported, unless both share TEMPLATE_SECRET', async (t) => {
    const a = await startApi();
    const b = await startApi();
    const sharedA = await startApi({ templateSecret: 'shared-secret-for-both-servers' });
    const sharedB = await startApi({ templateSecret: 'shared-secret-for-both-servers' });
    t.after(() => Promise.all([a, b, sharedA, sharedB].map((x) => x.close())));
    const fileFrom = async (app) => {
      const c = await creator(app.base, 'key@corp.local');
      return (await exportTemplate(c, (await c.createSurvey(FIELDS)).id)).json;
    };
    const inB = await creator(b.base, 'importer@corp.local');
    assert.equal((await check(inB, await fileFrom(a))).status, 422);
    const inSharedB = await creator(sharedB.base, 'importer@corp.local');
    assert.equal((await check(inSharedB, await fileFrom(sharedA))).status, 200);
  });

  test('the generated key is kept in the database, so exports stay valid after a restart', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'sharevy-tpl-'));
    let second;
    // Close the server (it holds the database file) before deleting the folder: Windows locks open files.
    t.after(async () => {
      await second?.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const dbPath = join(dir, 'k.db');
    const first = await startApi({}, { dbPath });
    const c = await creator(first.base, 'restart@corp.local');
    const file = (await exportTemplate(c, (await c.createSurvey(FIELDS)).id)).json;
    await first.close();
    second = await startApi({}, { dbPath });
    const again = new Client(second.base);
    assert.equal((await again.login('restart@corp.local')).status, 200);
    assert.equal((await check(again, file)).status, 200);
  });
});
