import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, startApi } from './helpers.js';

const MASTER = 'master-password-123';
const FIELDS = [{ label: 'Department', type: 'radio', required: true, options: ['IT', 'HR'] }];

/** A client holding the admin's token (not a creator account). */
async function admin(base, password = MASTER) {
  const c = new Client(base);
  const res = await c.request('/admin/login', { method: 'POST', body: { password } });
  assert.equal(res.status, 200, res.text);
  c.token = res.json.token;
  return c;
}

async function creator(base, email, password = 'secret123') {
  const c = new Client(base);
  assert.equal((await c.register(email, 'Creator', password)).status, 201);
  return c;
}

describe('admin: master password', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('a new instance has no master password; admin endpoints need the admin token', async () => {
    const c = new Client(app.base);
    assert.deepEqual((await c.request('/admin/status')).json, { configured: false, fun: false });
    const res = await c.request('/admin/users');
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'unauthorized');
    // Logging in before it exists says so.
    const login = await c.request('/admin/login', { method: 'POST', body: { password: MASTER } });
    assert.equal(login.status, 409);
    assert.equal(login.json.error.code, 'admin_not_configured');
  });

  test('setup checks the password: 12 to 200 characters, and the confirmation when sent', async () => {
    const c = new Client(app.base);
    const short = await c.request('/admin/setup', { method: 'POST', body: { password: 'short-pass' } });
    assert.equal(short.status, 422);
    assert.equal(short.json.error.fields.password.code, 'admin_password_length');
    const mismatch = await c.request('/admin/setup', { method: 'POST', body: { password: MASTER, confirm: 'something-else-123' } });
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.json.error.fields.confirm.code, 'password_mismatch');
    assert.deepEqual((await c.request('/admin/status')).json, { configured: false, fun: false });
  });

  test('the first setup creates the only master password and logs in; any later setup is refused', async () => {
    const c = new Client(app.base);
    // Several at once: exactly one wins.
    const attempts = await Promise.all([MASTER, 'another-password-1', 'another-password-2']
      .map((password) => c.request('/admin/setup', { method: 'POST', body: { password, confirm: password } })));
    const won = attempts.filter((r) => r.status === 201);
    assert.equal(won.length, 1, attempts.map((r) => r.status).join());
    assert.ok(typeof won[0].json.token === 'string' && won[0].json.token.length >= 32);
    for (const lost of attempts.filter((r) => r.status !== 201)) {
      assert.equal(lost.status, 409);
      assert.equal(lost.json.error.code, 'admin_exists');
    }
    assert.deepEqual((await c.request('/admin/status')).json, { configured: true, fun: false });
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM admin').get().n, 1);
    // The winner's token works; the password is stored hashed.
    c.token = won[0].json.token;
    assert.equal((await c.request('/admin/users')).status, 200);
    assert.match(app.db.prepare('SELECT password_hash FROM admin').get().password_hash, /^scrypt\$/);
  });

  test('the database allows a single admin row', () => {
    assert.throws(() => app.db.prepare("INSERT INTO admin (id, password_hash, session_key) VALUES (2, 'x', 'y')").run(), /CHECK constraint failed/);
  });
});

describe('admin: login, guard and reset', () => {
  let app;
  let password;
  before(async () => {
    app = await startApi({ loginMaxFailures: 3 });
    const c = new Client(app.base);
    password = MASTER;
    assert.equal((await c.request('/admin/setup', { method: 'POST', body: { password } })).status, 201);
  });
  after(() => app.close());

  test('a wrong password is refused; the right one gives a token; logout ends it', async () => {
    const c = new Client(app.base);
    const wrong = await c.request('/admin/login', { method: 'POST', body: { password: 'not-the-password' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error.code, 'invalid_credentials');
    const a = await admin(app.base, password);
    assert.equal((await a.request('/admin/users')).status, 200);
    assert.equal((await a.request('/admin/logout', { method: 'POST' })).status, 204);
    assert.equal((await a.request('/admin/users')).status, 401);
  });

  test('creator tokens never open admin endpoints, and the admin token is not a creator session', async () => {
    const creatorClient = await creator(app.base, 'guard@corp.local');
    assert.equal((await creatorClient.request('/admin/users')).status, 401);
    const a = await admin(app.base, password);
    assert.equal((await a.request('/surveys')).status, 401);
    assert.equal((await a.request('/me')).status, 401);
  });

  test('deleting the admin row in the database resets it: old tokens stop working and setup is open again', async () => {
    const a = await admin(app.base, password);
    app.db.exec('DELETE FROM admin');
    assert.equal((await a.request('/admin/users')).status, 401);
    const c = new Client(app.base);
    assert.deepEqual((await c.request('/admin/status')).json, { configured: false, fun: false });
    password = 'a-brand-new-master-1';
    assert.equal((await c.request('/admin/setup', { method: 'POST', body: { password } })).status, 201);
    assert.equal((await a.request('/admin/users')).status, 401, 'tokens from before the reset stay dead');
  });

  test('too many wrong passwords from one address are refused for a while (429)', async () => {
    const c = new Client(app.base);
    for (let i = 0; i < 3; i++) {
      assert.equal((await c.request('/admin/login', { method: 'POST', body: { password: `wrong-${i}-password` } })).status, 401);
    }
    const limited = await c.request('/admin/login', { method: 'POST', body: { password } });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, 'too_many_login_attempts');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

describe('admin: users and their surveys', () => {
  let app;
  let a;
  before(async () => {
    app = await startApi({ webBaseUrl: 'http://web.local:3000' });
    assert.equal((await new Client(app.base).request('/admin/setup', { method: 'POST', body: { password: MASTER } })).status, 201);
    a = await admin(app.base);
  });
  after(() => app.close());

  test('lists every user with how many surveys they have, newest first, without password hashes', async () => {
    const ana = await creator(app.base, 'ana@corp.local');
    await ana.createSurvey(FIELDS, 'One');
    await ana.createSurvey(FIELDS, 'Two');
    await creator(app.base, 'luis@corp.local');
    const { users } = (await a.request('/admin/users')).json;
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
    assert.equal(byEmail['ana@corp.local'].surveyCount, 2);
    assert.equal(byEmail['luis@corp.local'].surveyCount, 0);
    assert.equal(users[0].email, 'luis@corp.local');
    assert.deepEqual(Object.keys(byEmail['ana@corp.local']).sort(), ['createdAt', 'email', 'id', 'name', 'surveyCount']);
    assert.match(byEmail['ana@corp.local'].createdAt, /Z$/);
  });

  test("lists one user's surveys; closes, reopens, edits and deletes them like their owner", async () => {
    const owner = await creator(app.base, 'owner@corp.local');
    const survey = await owner.createSurvey(FIELDS, 'Lunch');
    const userId = (await owner.request('/me')).json.user.id;

    const listed = (await a.request(`/admin/users/${userId}/surveys`)).json.surveys;
    assert.deepEqual(listed.map((s) => [s.id, s.title, s.isOpen, s.responseCount]), [[survey.id, 'Lunch', true, 0]]);
    assert.equal(listed[0].shareUrl, `http://web.local:3000/s/${survey.publicToken}`);
    assert.equal(listed[0].ownerId, userId);

    const closed = await a.request(`/admin/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: false } });
    assert.equal(closed.status, 200);
    assert.equal(closed.json.survey.isOpen, false);
    assert.equal((await owner.request(`/surveys/${survey.id}`)).json.survey.isOpen, false);
    assert.equal((await a.request(`/admin/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: true } })).json.survey.isOpen, true);

    const full = (await a.request(`/admin/surveys/${survey.id}`)).json.survey;
    assert.equal(full.fields.length, 1);
    const edited = await a.request(`/admin/surveys/${survey.id}`, {
      method: 'PUT',
      body: { title: 'Lunch (edited)', description: '', closesOn: full.closesOn, fields: full.fields },
    });
    assert.equal(edited.status, 200, edited.text);
    assert.equal((await owner.request(`/surveys/${survey.id}`)).json.survey.title, 'Lunch (edited)');
    // Same validation as the owner's editor.
    const invalid = await a.request(`/admin/surveys/${survey.id}`, { method: 'PUT', body: { title: '', closesOn: full.closesOn, fields: full.fields } });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.json.error.errors[0].code, 'title_required');
    const badState = await a.request(`/admin/surveys/${survey.id}`, { method: 'PATCH', body: { isOpen: 'no' } });
    assert.equal(badState.status, 422);

    assert.equal((await a.request(`/admin/surveys/${survey.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await owner.request(`/surveys/${survey.id}`)).status, 404);
    assert.equal((await a.request(`/admin/surveys/${survey.id}`)).status, 404);
  });

  test('unknown users and surveys are 404', async () => {
    assert.equal((await a.request('/admin/users/999999/surveys')).status, 404);
    assert.equal((await a.request('/admin/users/abc/surveys')).status, 404);
    assert.equal((await a.request('/admin/surveys/999999', { method: 'PATCH', body: { isOpen: false } })).status, 404);
    assert.equal((await a.request('/admin/users/999999', { method: 'DELETE' })).status, 404);
  });

  test("editing a user's name and email: same rules as registration; they log in with the new email and stay logged in", async () => {
    const user = await creator(app.base, 'rename@corp.local');
    await creator(app.base, 'taken@corp.local');
    const userId = (await user.request('/me')).json.user.id;
    const edit = (body) => a.request(`/admin/users/${userId}`, { method: 'PATCH', body });

    const both = await edit({ name: '  Ana María  ', email: 'ana.maria@corp.local' });
    assert.equal(both.status, 200, both.text);
    assert.deepEqual([both.json.user.name, both.json.user.email, both.json.user.surveyCount], ['Ana María', 'ana.maria@corp.local', 0]);
    assert.equal((await user.request('/me')).json.user.email, 'ana.maria@corp.local', 'sessions stay open');
    assert.equal((await new Client(app.base).login('ana.maria@corp.local')).status, 200);
    assert.equal((await new Client(app.base).login('rename@corp.local')).status, 401);

    // Only the field sent changes; their own address in other letter case is not "taken".
    assert.equal((await edit({ name: 'Ana' })).json.user.email, 'ana.maria@corp.local');
    assert.equal((await edit({ email: 'ANA.MARIA@corp.local' })).status, 200);

    const taken = await edit({ email: 'Taken@corp.local' });
    assert.equal(taken.status, 422);
    assert.equal(taken.json.error.fields.email.code, 'email_taken');
    const invalid = await edit({ name: ' ', email: 'not-an-email' });
    assert.equal(invalid.status, 422);
    assert.deepEqual([invalid.json.error.fields.name.code, invalid.json.error.fields.email.code], ['name_invalid', 'email_invalid']);
    assert.equal((await edit({ name: 'x'.repeat(101) })).json.error.fields.name.code, 'name_invalid');
    assert.equal((await user.request('/me')).json.user.name, 'Ana', 'nothing changes when something is invalid');

    assert.equal((await a.request('/admin/users/999999', { method: 'PATCH', body: { name: 'Nobody' } })).status, 404);
    assert.equal((await user.request(`/admin/users/${userId}`, { method: 'PATCH', body: { name: 'Me' } })).status, 401, 'creators cannot use it');
  });

  test("setting a user's password ends their sessions and lets them log in with the new one", async () => {
    const user = await creator(app.base, 'forgot@corp.local');
    const userId = (await user.request('/me')).json.user.id;
    const short = await a.request(`/admin/users/${userId}/password`, { method: 'PUT', body: { password: 'short' } });
    assert.equal(short.status, 422);
    assert.equal(short.json.error.fields.password.code, 'password_length');
    assert.equal((await a.request(`/admin/users/${userId}/password`, { method: 'PUT', body: { password: 'new-secret-456' } })).status, 204);
    assert.equal((await user.request('/me')).status, 401, 'old sessions end');
    const fresh = new Client(app.base);
    assert.equal((await fresh.login('forgot@corp.local', 'secret123')).status, 401);
    assert.equal((await fresh.login('forgot@corp.local', 'new-secret-456')).status, 200);
  });

  test('deleting a user deletes their surveys and answers, and ends their sessions', async () => {
    const user = await creator(app.base, 'leaving@corp.local');
    const survey = await user.createSurvey(FIELDS);
    const userId = (await user.request('/me')).json.user.id;
    assert.equal((await a.request(`/admin/users/${userId}`, { method: 'DELETE' })).status, 204);
    assert.equal((await user.request('/me')).status, 401);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM surveys WHERE id = ?').get(survey.id).n, 0);
    assert.ok(!(await a.request('/admin/users')).json.users.some((u) => u.id === userId));
  });
});

describe('admin: login limit under a burst', () => {
  let app;
  before(async () => {
    app = await startApi({ loginMaxFailures: 3 });
    assert.equal((await new Client(app.base).request('/admin/setup', { method: 'POST', body: { password: MASTER } })).status, 201);
  });
  after(() => app.close());

  test('wrong passwords sent all at once are counted before checking, so only the limit gets through', async () => {
    const c = new Client(app.base);
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => c.request('/admin/login', { method: 'POST', body: { password: `wrong-guess-${i}-xx` } })));
    const statuses = burst.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 401).length, 3, statuses.join());
    assert.equal(statuses.filter((s) => s === 429).length, 9, statuses.join());
    assert.equal((await c.request('/admin/login', { method: 'POST', body: { password: MASTER } })).status, 429, 'the right password waits too');
  });
});

describe('admin: FUN', () => {
  test('/admin/status says whether FUN is on, so the login page can show its message', async (t) => {
    const app = await startApi({ fun: true });
    t.after(() => app.close());
    assert.deepEqual((await new Client(app.base).request('/admin/status')).json, { configured: false, fun: true });
  });
});
