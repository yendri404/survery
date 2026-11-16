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
    return Number(res.location.split('/').pop());
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
    assert.match((await c.request('/surveys')).text, /Log out \(Ana\)/);

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
    assert.match(csv.text, /Response ID,Submitted at \(UTC\),Your name,Department,Tools\r\n/);
    assert.match(csv.text, /,"'=Luis, ""Lu""",HR,"Mail, Chat"\r\n/);

    const csvSemicolon = await creator.request(`/surveys/${id}/export.csv?delimiter=semicolon`);
    assert.match(csvSemicolon.text, /Response ID;Submitted at \(UTC\);Your name;Department;Tools\r\n/);
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
