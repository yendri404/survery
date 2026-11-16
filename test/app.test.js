import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';

async function startApp(overrides = {}) {
  const db = openDatabase(':memory:');
  const server = createApp({ db, config: { ...loadConfig({}), ...overrides } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => { db.close(); resolve(); });
    }),
  };
}

/** Minimal browser-like client that keeps the session cookie. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async request(path, { method = 'GET', form } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [name, value] = c.split(';')[0].split('=');
      if (name === 'sid') this.cookie = value ? `sid=${value}` : '';
    }
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text: await res.text() };
  }

  async csrf(path = '/surveys') {
    const { text } = await this.request(path);
    return text.match(/name="_csrf" value="([^"]+)"/)[1];
  }

  register(email, name = 'Creator', password = 'secret123') {
    return this.request('/register', { method: 'POST', form: { name, email, password, confirm: password } });
  }

  async createSurvey(fields, title = 'Workplace survey') {
    const _csrf = await this.csrf('/surveys/new');
    const res = await this.request('/surveys', {
      method: 'POST', form: { _csrf, title, description: 'Internal', fields_json: JSON.stringify(fields) },
    });
    assert.equal(res.status, 303, res.text);
    return Number(res.location.match(/^\/surveys\/(\d+)/)[1]);
  }

  async shareToken(surveyId) {
    const { text } = await this.request(`/surveys/${surveyId}`);
    return text.match(/\/s\/([A-Za-z0-9_-]+)"/)[1];
  }
}

const FIELDS = [
  { label: 'Your name', type: 'text', required: true },
  { label: 'Department', type: 'select', required: true, options: ['IT', 'HR'] },
  { label: 'Tools', type: 'checkbox', options: ['Mail', 'Chat'] },
];

describe('survey app', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(() => app.close());

  test('creator pages require login', async () => {
    const res = await new Client(app.base).request('/surveys/new');
    assert.equal(res.status, 303);
    assert.equal(res.location, '/login?next=%2Fsurveys%2Fnew');
  });

  test('register, logout and login again', async () => {
    const c = new Client(app.base);
    const reg = await c.register('ana@corp.local', 'Ana');
    assert.equal(reg.status, 303);
    assert.equal(reg.location, '/surveys');
    const dashboard = (await c.request('/surveys')).text;
    assert.match(dashboard, /class="who">Ana</);
    assert.match(dashboard, /Log out/);

    const out = await c.request('/logout', { method: 'POST', form: { _csrf: await c.csrf() } });
    assert.equal(out.status, 303);
    assert.equal(c.cookie, '');
    assert.equal((await c.request('/surveys')).status, 303);

    const bad = await c.request('/login', { method: 'POST', form: { email: 'ana@corp.local', password: 'wrong-pass' } });
    assert.equal(bad.status, 401);
    assert.match(bad.text, /Invalid email or password/);

    const ok = await c.request('/login', { method: 'POST', form: { email: 'ANA@corp.local', password: 'secret123', next: '/surveys/new' } });
    assert.equal(ok.status, 303);
    assert.equal(ok.location, '/surveys/new');
  });

  test('duplicate registration and invalid input are rejected', async () => {
    const c = new Client(app.base);
    await c.register('dup@corp.local');
    const again = await new Client(app.base).register('dup@corp.local');
    assert.equal(again.status, 422);
    assert.match(again.text, /already exists/);
    const weak = await new Client(app.base).register('weak@corp.local', 'W', 'short');
    assert.equal(weak.status, 422);
    assert.match(weak.text, /between 8 and 200/);
  });

  test('login ignores external redirect targets', async () => {
    const c = new Client(app.base);
    await c.register('redir@corp.local');
    const res = await c.request('/login', { method: 'POST', form: { email: 'redir@corp.local', password: 'secret123', next: '//evil.example' } });
    assert.equal(res.location, '/surveys');

    // Browsers strip tabs/newlines when parsing URLs, so "/\t/evil" would become "//evil".
    for (const next of ['/\t/evil.example', '/\n/evil.example', '/\\evil.example']) {
      const post = await c.request('/login', { method: 'POST', form: { email: 'redir@corp.local', password: 'secret123', next } });
      assert.equal(post.location, '/surveys', JSON.stringify(next));
    }
    const get = await c.request('/login?next=%2F%09%2Fevil.example');
    assert.equal(get.location, '/surveys');

    const valid = await c.request('/login?next=%2Fsurveys%2Fnew%3Fa%3D1');
    assert.equal(valid.location, '/surveys/new?a=1');
  });

  test('full flow: create survey, answer anonymously, see results and export CSV', async () => {
    const creator = new Client(app.base);
    await creator.register('flow@corp.local');
    const id = await creator.createSurvey(FIELDS);
    const token = await creator.shareToken(id);

    const respondent = new Client(app.base);
    const form = await respondent.request(`/s/${token}`);
    assert.equal(form.status, 200);
    assert.match(form.text, /Your name/);
    assert.doesNotMatch(form.text, /Log in/);

    const fieldNames = [...form.text.matchAll(/name="(f_[a-z0-9]+)"/g)].map((m) => m[1]);
    const [nameField, deptField, toolsField] = [...new Set(fieldNames)];

    const invalid = await respondent.request(`/s/${token}`, { method: 'POST', form: [[deptField, 'IT']] });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /This field is required/);
    assert.match(invalid.text, /<option value="IT" selected>/);

    const ok = await respondent.request(`/s/${token}`, {
      method: 'POST', form: [[nameField, '=Luis, "Lu"'], [deptField, 'HR'], [toolsField, 'Chat'], [toolsField, 'Mail']],
    });
    assert.equal(ok.status, 303);
    assert.equal(ok.location, `/s/${token}/thanks`);
    assert.equal(respondent.cookie, '');

    const detail = await creator.request(`/surveys/${id}`);
    assert.match(detail.text, /Responses \(1\)/);
    assert.match(detail.text, /Mail, Chat/);

    const csv = await creator.request(`/surveys/${id}/export.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /Response ID,Submitted at \(UTC\),Name,Your name,Department,Tools\r\n/);
    assert.match(csv.text, /,"'=Luis, ""Lu""",HR,"Mail, Chat"\r\n/);

    const csvSemicolon = await creator.request(`/surveys/${id}/export.csv?delimiter=semicolon`);
    assert.match(csvSemicolon.text, /Response ID;Submitted at \(UTC\);Name;Your name;Department;Tools\r\n/);
  });

  test('respondents can optionally leave their name', async () => {
    const c = new Client(app.base);
    await c.register('names@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await c.shareToken(id);
    const form = await new Client(app.base).request(`/s/${token}`);
    assert.match(form.text, /name="respondent_name"/);
    assert.match(form.text, /optional/i);
    const field = form.text.match(/name="(f_[a-z0-9]+)"/)[1];

    const r = new Client(app.base);
    assert.equal((await r.request(`/s/${token}`, { method: 'POST', form: [['respondent_name', '  Marta Gómez '], [field, 'x']] })).status, 303);
    assert.equal((await r.request(`/s/${token}`, { method: 'POST', form: [[field, 'y']] })).status, 303);
    const tooLong = await r.request(`/s/${token}`, { method: 'POST', form: [['respondent_name', 'a'.repeat(101)], [field, 'z']] });
    assert.equal(tooLong.status, 422);
    assert.match(tooLong.text, /Name must be at most 100 characters/);
    assert.match(tooLong.text, /value="a{101}"/);

    const detail = (await c.request(`/surveys/${id}`)).text;
    assert.match(detail, /Responses \(2\)/);
    assert.match(detail, /Marta Gómez/);
    assert.match(detail, /Anonymous/);
    const csv = (await c.request(`/surveys/${id}/export.csv`)).text;
    assert.match(csv, /Response ID,Submitted at \(UTC\),Name,Q\r\n/);
    assert.match(csv, /,Marta Gómez,x\r\n/);
    assert.match(csv, /,,y\r\n/);
  });

  test('closed surveys reject responses until reopened', async () => {
    const creator = new Client(app.base);
    await creator.register('close@corp.local');
    const id = await creator.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await creator.shareToken(id);
    await creator.request(`/surveys/${id}/toggle`, { method: 'POST', form: { _csrf: await creator.csrf() } });

    const respondent = new Client(app.base);
    assert.match((await respondent.request(`/s/${token}`)).text, /survey is closed/);
    const post = await respondent.request(`/s/${token}`, { method: 'POST', form: {} });
    assert.equal(post.status, 403);

    await creator.request(`/surveys/${id}/toggle`, { method: 'POST', form: { _csrf: await creator.csrf() } });
    assert.equal((await respondent.request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
  });

  test('creators cannot see or modify surveys of other creators', async () => {
    const owner = new Client(app.base);
    await owner.register('owner@corp.local');
    const id = await owner.createSurvey([{ label: 'Q', type: 'text' }]);

    const other = new Client(app.base);
    await other.register('other@corp.local');
    assert.equal((await other.request(`/surveys/${id}`)).status, 404);
    assert.equal((await other.request(`/surveys/${id}/export.csv`)).status, 404);
    const del = await other.request(`/surveys/${id}/delete`, { method: 'POST', form: { _csrf: await other.csrf() } });
    assert.equal(del.status, 404);
    assert.equal((await owner.request(`/surveys/${id}`)).status, 200);
  });

  test('state-changing requests require a valid CSRF token', async () => {
    const c = new Client(app.base);
    await c.register('csrf@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const res = await c.request(`/surveys/${id}/delete`, { method: 'POST', form: { _csrf: 'forged' } });
    assert.equal(res.status, 403);
    assert.equal((await c.request(`/surveys/${id}`)).status, 200);
  });

  test('editing keeps field ids so existing answers still show', async () => {
    const c = new Client(app.base);
    await c.register('edit@corp.local');
    const id = await c.createSurvey([{ label: 'Original', type: 'text' }]);
    const token = await c.shareToken(id);
    const form = await new Client(app.base).request(`/s/${token}`);
    const field = form.text.match(/name="(f_[a-z0-9]+)"/)[1];
    await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: [[field, 'kept answer']] });

    const edit = await c.request(`/surveys/${id}/edit`);
    const fieldsJson = edit.text.match(/id="fields_json" value="([^"]*)"/)[1].replace(/&quot;/g, '"');
    const fields = JSON.parse(fieldsJson);
    fields[0].label = 'Renamed';
    fields.push({ label: 'New one', type: 'number' });
    const save = await c.request(`/surveys/${id}`, {
      method: 'POST', form: { _csrf: await c.csrf(), title: 'Edited', description: '', fields_json: JSON.stringify(fields) },
    });
    assert.equal(save.status, 303);
    const detail = await c.request(`/surveys/${id}`);
    assert.match(detail.text, /Renamed/);
    assert.match(detail.text, /kept answer/);
  });

  test('invalid survey definitions are rejected with messages', async () => {
    const c = new Client(app.base);
    await c.register('invalid@corp.local');
    const res = await c.request('/surveys', { method: 'POST', form: { _csrf: await c.csrf(), title: '', fields_json: '[]' } });
    assert.equal(res.status, 422);
    assert.match(res.text, /Title is required/);
    assert.match(res.text, /Add at least one field/);
  });

  test('pages carry the Sharevy brand and a mobile viewport', async () => {
    const home = await new Client(app.base).request('/');
    assert.match(home.text, /<title>Sharevy<\/title>/);
    assert.match(home.text, /<meta name="viewport" content="width=device-width, initial-scale=1">/);

    // Assets are versioned by content so browsers never keep a stale stylesheet after an update.
    const css = home.text.match(/href="(\/public\/style\.css\?v=[0-9a-f]{10})"/)[1];
    const asset = await fetch(app.base + css);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);

    const c = new Client(app.base);
    await c.register('brand@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }], 'Team lunch');
    assert.match((await c.request(`/surveys/${id}`)).text, /<title>Team lunch · Sharevy<\/title>/);
    const token = await c.shareToken(id);
    const form = await new Client(app.base).request(`/s/${token}`);
    assert.match(form.text, /<title>Team lunch · Sharevy<\/title>/);
  });

  test('creator and respondent pages offer a theme switch applied before rendering', async () => {
    const c = new Client(app.base);
    await c.register('theme@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await c.shareToken(id);
    for (const page of [(await new Client(app.base).request('/')).text, (await new Client(app.base).request(`/s/${token}`)).text]) {
      // Loaded in <head> (not deferred) so the saved theme applies before the first paint.
      assert.match(page, /<head>[\s\S]*<script src="\/public\/theme\.js\?v=[0-9a-f]{10}"><\/script>[\s\S]*<\/head>/);
      assert.match(page, /<button type="button"[^>]*data-theme-toggle[^>]*aria-label="Switch to dark theme"/);
    }
    const script = await fetch(`${app.base}/public/theme.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
  });

  test('actions redirect with a confirmation message', async () => {
    const c = new Client(app.base);
    await c.register('flash@corp.local');
    const _csrf = await c.csrf('/surveys/new');
    const created = await c.request('/surveys', {
      method: 'POST', form: { _csrf, title: 'Flash', fields_json: JSON.stringify([{ label: 'Q', type: 'text' }]) },
    });
    assert.match(created.location, /^\/surveys\/\d+\?msg=created$/);
    const id = Number(created.location.match(/\d+/)[0]);
    assert.match((await c.request(created.location)).text, /Survey created/);

    const toggled = await c.request(`/surveys/${id}/toggle`, { method: 'POST', form: { _csrf } });
    assert.equal(toggled.location, `/surveys/${id}?msg=closed`);
    const deleted = await c.request(`/surveys/${id}/delete`, { method: 'POST', form: { _csrf } });
    assert.equal(deleted.location, '/surveys?msg=deleted');
    assert.match((await c.request(deleted.location)).text, /Survey deleted/);

    // Unknown message keys are ignored, never reflected.
    assert.doesNotMatch((await c.request('/surveys?msg=<script>')).text, /&lt;script&gt;|<script>alert/);
  });

  test('unknown share links return 404 without creator navigation', async () => {
    const res = await new Client(app.base).request('/s/does-not-exist');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /Log in/);
  });

  test('user content is HTML-escaped', async () => {
    const c = new Client(app.base);
    await c.register('xss@corp.local');
    const id = await c.createSurvey([{ label: '<script>alert(1)</script>', type: 'text' }], '<b>Title</b>');
    const detail = await c.request(`/surveys/${id}`);
    assert.doesNotMatch(detail.text, /<script>alert/);
    assert.match(detail.text, /&lt;b&gt;Title&lt;\/b&gt;/);
  });
});

describe('abuse protection', () => {
  let app;
  before(async () => { app = await startApp({ loginMaxFailures: 3, submissionLimit: 2 }); });
  after(() => app.close());

  test('login is blocked after repeated failures for the same email and IP', async () => {
    const c = new Client(app.base);
    await c.register('brute@corp.local');
    const attacker = new Client(app.base);
    for (let i = 0; i < 3; i++) {
      const res = await attacker.request('/login', { method: 'POST', form: { email: 'brute@corp.local', password: 'wrong-pass' } });
      assert.equal(res.status, 401);
    }
    const blocked = await attacker.request('/login', { method: 'POST', form: { email: 'brute@corp.local', password: 'secret123' } });
    assert.equal(blocked.status, 429);
    assert.match(blocked.text, /Too many failed login attempts/);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);

    // Other accounts are not affected by failures against a different email.
    await new Client(app.base).register('safe@corp.local');
    const other = await attacker.request('/login', { method: 'POST', form: { email: 'safe@corp.local', password: 'secret123' } });
    assert.equal(other.status, 303);
  });

  test('anonymous submissions are rate limited per survey and IP', async () => {
    const creator = new Client(app.base);
    await creator.register('flood@corp.local');
    const id = await creator.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await creator.shareToken(id);
    const r = new Client(app.base);
    assert.equal((await r.request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
    assert.equal((await r.request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
    const blocked = await r.request(`/s/${token}`, { method: 'POST', form: {} });
    assert.equal(blocked.status, 429);
    assert.match(blocked.text, /Too many responses/);
    assert.match((await creator.request(`/surveys/${id}`)).text, /Responses \(2\)/);
  });

  test('session ids are stored hashed, not as the cookie value', async () => {
    const c = new Client(app.base);
    await c.register('hash@corp.local');
    const raw = c.cookie.slice('sid='.length);
    const ids = app.db.prepare('SELECT id FROM sessions').all().map((s) => s.id);
    assert.ok(ids.length > 0);
    assert.ok(!ids.includes(raw));
    assert.equal((await c.request('/surveys')).status, 200);
  });
});

describe('closing date', () => {
  let app;
  let now = new Date(2026, 10, 16, 12, 0); // Nov 16, 2026, server local time
  before(async () => { app = await startApp({ now: () => now }); });
  after(() => app.close());

  test('surveys close 10 days after creation by default', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const c = new Client(app.base);
    await c.register('deadline@corp.local');
    const editor = (await c.request('/surveys/new')).text;
    assert.match(editor, /<input type="date" name="closes_on" value="2026-11-26" min="2026-11-16"/);

    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    assert.match((await c.request(`/surveys/${id}`)).text, /Closes on Nov 26, 2026/);
    const token = await c.shareToken(id);
    const respondent = new Client(app.base);
    assert.match((await respondent.request(`/s/${token}`)).text, /Open until Nov 26, 2026/);

    now = new Date(2026, 10, 26, 23, 59); // still open during the whole closing day
    assert.equal((await respondent.request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);

    now = new Date(2026, 10, 27, 0, 1);
    assert.match((await respondent.request(`/s/${token}`)).text, /closed on Nov 26, 2026/);
    assert.equal((await respondent.request(`/s/${token}`, { method: 'POST', form: {} })).status, 403);
    assert.match((await c.request('/surveys')).text, /Expired/);
    assert.match((await c.request(`/surveys/${id}`)).text, /Change the closing date/);
  });

  test('the closing date is chosen when creating and can extend an expired survey', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const c = new Client(app.base);
    await c.register('extend@corp.local');
    const _csrf = await c.csrf('/surveys/new');
    const fields_json = JSON.stringify([{ label: 'Q', type: 'text' }]);

    const past = await c.request('/surveys', { method: 'POST', form: { _csrf, title: 'Past', fields_json, closes_on: '2026-11-10' } });
    assert.equal(past.status, 422);
    assert.match(past.text, /The closing date cannot be in the past/);

    const created = await c.request('/surveys', { method: 'POST', form: { _csrf, title: 'Short', fields_json, closes_on: '2026-11-17' } });
    const id = Number(created.location.match(/\d+/)[0]);
    const token = await c.shareToken(id);

    now = new Date(2026, 10, 20, 9, 0);
    const edit = (await c.request(`/surveys/${id}/edit`)).text;
    assert.match(edit, /name="closes_on" value="2026-11-17"/);
    const fieldsJson = edit.match(/id="fields_json" value="([^"]*)"/)[1].replace(/&quot;/g, '"');
    const saved = await c.request(`/surveys/${id}`, { method: 'POST', form: { _csrf, title: 'Short', fields_json: fieldsJson, closes_on: '2026-11-30' } });
    assert.equal(saved.status, 303);
    assert.equal((await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
  });
});

describe('registration disabled', () => {
  let app;
  before(async () => { app = await startApp({ allowRegistration: false }); });
  after(() => app.close());

  test('register endpoints return 404', async () => {
    const c = new Client(app.base);
    assert.equal((await c.request('/register')).status, 404);
    assert.equal((await c.register('x@corp.local')).status, 404);
  });
});
