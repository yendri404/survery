import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import QRCode from 'qrcode';
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

/** Minimal browser-like client with a cookie jar (session and device cookies). */
class Client {
  /** `language` is sent as Accept-Language; without it, fetch sends "*" (English). */
  constructor(base, { language } = {}) {
    this.base = base;
    this.jar = new Map();
    this.language = language;
  }

  /** Cookie header value, as a browser would send it. */
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get sid() {
    return this.jar.get('sid') ?? '';
  }

  async request(path, { method = 'GET', form } = {}) {
    const headers = {};
    if (this.jar.size) headers.cookie = this.cookie;
    if (this.language) headers['accept-language'] = this.language;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [name, value] = c.split(';')[0].split('=');
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
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

/** Opens a Server-Sent Events stream and lets a test wait for text to arrive on it. */
async function openEvents(url, cookie) {
  const controller = new AbortController();
  const res = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual', signal: controller.signal });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let received = '';
  return {
    res,
    async waitFor(pattern, ms = 2000) {
      const deadline = Date.now() + ms;
      while (!pattern.test(received)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timed out waiting for ${pattern}; got: ${JSON.stringify(received)}`);
        let timer;
        const chunk = await Promise.race([
          reader.read(),
          new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), left); }),
        ]);
        clearTimeout(timer);
        if (chunk.done) throw new Error('stream ended');
        if (chunk.value) received += decoder.decode(chunk.value, { stream: true });
      }
      const match = received;
      received = '';
      return match;
    },
    close: () => controller.abort(),
  };
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
    assert.equal(c.sid, '');
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
    assert.equal(respondent.sid, '', 'respondents never get a session');
    assert.ok(respondent.jar.has('sharevy_device'), 'respondents get a device cookie');

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

    const send = (form) => new Client(app.base).request(`/s/${token}`, { method: 'POST', form });
    assert.equal((await send([['respondent_name', '  Marta Gómez '], [field, 'x']])).status, 303);
    assert.equal((await send([[field, 'y']])).status, 303);
    const tooLong = await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: [['respondent_name', 'a'.repeat(101)], [field, 'z']] });
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

  test('the share section shows a QR code of the link and offers it as a PNG download', async () => {
    const c = new Client(app.base);
    await c.register('qr@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const detail = (await c.request(`/surveys/${id}`)).text;
    const shareUrl = detail.match(/id="share-url" class="share-url" value="([^"]+)"/)[1];

    // The inline QR encodes exactly the share link.
    const expected = (await QRCode.toString(shareUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }))
      .trim().replace('<svg ', '<svg role="img" aria-label="QR code that opens this survey" ');
    assert.ok(detail.includes(expected), 'inline QR must encode the share URL');
    assert.match(detail, new RegExp(`href="/surveys/${id}/qr\\.png"`));

    const png = await fetch(`${app.base}/surveys/${id}/qr.png`, { headers: { cookie: c.cookie } });
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('content-disposition'), /attachment; filename="sharevy-survey-\d+-qr\.png"/);
    const bytes = Buffer.from(await png.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const other = new Client(app.base);
    await other.register('qr-other@corp.local');
    assert.equal((await other.request(`/surveys/${id}/qr.png`)).status, 404);
    assert.equal((await new Client(app.base).request(`/surveys/${id}/qr.png`)).status, 303);
  });

  test('creators get live change events when someone answers', async () => {
    const c = new Client(app.base);
    await c.register('live@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await c.shareToken(id);

    const detail = (await c.request(`/surveys/${id}`)).text;
    assert.match(detail, new RegExp(`<section id="responses" data-live="/surveys/${id}/events">`));
    assert.match((await c.request('/surveys')).text, /<div id="survey-list" data-live="\/surveys\/events">/);

    const surveyStream = await openEvents(`${app.base}/surveys/${id}/events`, c.cookie);
    const listStream = await openEvents(`${app.base}/surveys/events`, c.cookie);
    try {
      assert.equal(surveyStream.res.status, 200);
      assert.match(surveyStream.res.headers.get('content-type'), /^text\/event-stream/);
      await surveyStream.waitFor(/: connected/);
      await listStream.waitFor(/: connected/);

      assert.equal((await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
      await surveyStream.waitFor(/event: change\ndata: /);
      await listStream.waitFor(/event: change\ndata: /);

      // Deleting a response also notifies (another open tab stays in sync).
      const responseId = (await c.request(`/surveys/${id}`)).text.match(/responses\/(\d+)\/delete/)[1];
      await c.request(`/surveys/${id}/responses/${responseId}/delete`, { method: 'POST', form: { _csrf: await c.csrf() } });
      await surveyStream.waitFor(/event: change/);
    } finally {
      surveyStream.close();
      listStream.close();
    }
  });

  test('live event streams are private to the survey owner', async () => {
    const owner = new Client(app.base);
    await owner.register('live-owner@corp.local');
    const id = await owner.createSurvey([{ label: 'Q', type: 'text' }]);
    const other = new Client(app.base);
    await other.register('live-other@corp.local');

    const foreign = await other.request(`/surveys/${id}/events`);
    assert.equal(foreign.status, 404);
    const anonymous = await new Client(app.base).request(`/surveys/${id}/events`);
    assert.equal(anonymous.status, 303);

    // Another creator's list stream never hears about this survey.
    const otherList = await openEvents(`${app.base}/surveys/events`, other.cookie);
    try {
      await otherList.waitFor(/: connected/);
      const token = await owner.shareToken(id);
      await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: {} });
      await assert.rejects(otherList.waitFor(/event: change/, 300), /timed out/);
    } finally {
      otherList.close();
    }
  });

  test('each device can answer a survey only once', async () => {
    const c = new Client(app.base);
    await c.register('once@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await c.shareToken(id);

    const phone = new Client(app.base);
    const first = await phone.request(`/s/${token}`, { method: 'POST', form: { f_nope: 'x' } });
    assert.equal(first.status, 303, 'first valid submission is accepted');
    assert.ok(phone.jar.has('sharevy_device'));
    assert.doesNotMatch((await phone.request(`/s/${token}/thanks`)).text, /Send another response/);

    const again = await phone.request(`/s/${token}`, { method: 'POST', form: {} });
    assert.equal(again.status, 409);
    assert.match(again.text, /already answered this survey/);
    const form = await phone.request(`/s/${token}`);
    assert.equal(form.status, 200);
    assert.match(form.text, /already answered this survey/);
    assert.doesNotMatch(form.text, /<form method="post" action="\/s\//);

    // Another device can still answer, and the same device can answer other surveys.
    assert.equal((await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
    const otherId = await c.createSurvey([{ label: 'Q2', type: 'text' }], 'Second');
    const otherToken = await c.shareToken(otherId);
    assert.equal((await phone.request(`/s/${otherToken}`, { method: 'POST', form: {} })).status, 303);
    assert.match((await c.request(`/surveys/${id}`)).text, /Responses \(2\)/);
  });

  test('simultaneous submissions from one device store a single response', async () => {
    const c = new Client(app.base);
    await c.register('race@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await c.shareToken(id);
    const post = () => fetch(`${app.base}/s/${token}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: 'sharevy_device=same-device-token-1234567890', 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    }).then((r) => r.status);
    const statuses = (await Promise.all([post(), post(), post()])).sort();
    assert.deepEqual(statuses, [303, 409, 409]);
    assert.match((await c.request(`/surveys/${id}`)).text, /Responses \(1\)/);
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

  test('surveys with repeated options or repeated questions are rejected', async () => {
    const c = new Client(app.base);
    await c.register('dupes@corp.local');
    const fields = [
      { label: 'Department', type: 'radio', options: ['IT', 'it'] },
      { label: 'DEPARTMENT', type: 'text' },
    ];
    const res = await c.request('/surveys', { method: 'POST', form: { _csrf: await c.csrf(), title: 'Dupes', fields_json: JSON.stringify(fields) } });
    assert.equal(res.status, 422);
    assert.match(res.text, /Field 1: the option &quot;IT&quot; is repeated. Each option must be different./);
    assert.match(res.text, /Fields 1 and 2 ask the same question. Each question must be different./);
  });

  test('yes/no questions show two fixed choices and their answers in the reader language', async () => {
    const c = new Client(app.base);
    await c.register('yesno@corp.local');
    const id = await c.createSurvey([{ label: 'Work remotely?', type: 'yesno', required: true }]);
    const token = await c.shareToken(id);

    const form = (await new Client(app.base).request(`/s/${token}`)).text;
    const name = form.match(/name="(f_[a-z0-9]+)"/)[1];
    const choices = [...form.matchAll(/<input type="radio" name="f_[a-z0-9]+" value="(\w+)"[^>]*>\s*<span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(choices, [['yes', 'Yes'], ['no', 'No']]);
    const spanishForm = (await new Client(app.base, { language: 'es' }).request(`/s/${token}`)).text;
    assert.match(spanishForm, /value="yes"[^>]*>\s*<span>Sí<\/span>/);

    const missing = await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: {} });
    assert.equal(missing.status, 422);
    assert.match(missing.text, /This field is required/);
    const wrong = await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: { [name]: 'maybe' } });
    assert.equal(wrong.status, 422);
    assert.match(wrong.text, /Invalid option selected/);
    assert.equal((await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: { [name]: 'yes' } })).status, 303);

    const detail = (await c.request(`/surveys/${id}`)).text;
    assert.match(detail, /<td data-label="Work remotely\?">Yes<\/td>/);
    assert.match(detail, /<span class="legend-label">Yes<\/span><span class="legend-value">1 \(100%\)<\/span>/);
    assert.match(detail, /<span class="legend-label">No<\/span><span class="legend-value">0 \(0%\)<\/span>/);
    assert.match((await c.request(`/surveys/${id}/export.csv`)).text, /,Yes\r\n$/);

    c.language = 'es';
    const spanishDetail = (await c.request(`/surveys/${id}`)).text;
    assert.match(spanishDetail, /<td data-label="Work remotely\?">Sí<\/td>/);
    assert.match(spanishDetail, /<span class="legend-label">Sí<\/span>/);
    assert.match((await c.request(`/surveys/${id}/export.csv`)).text, /,Sí\r\n$/);
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

  test('the header shows the Sharevy logo next to the name', async () => {
    const home = (await new Client(app.base).request('/')).text;
    const logo = home.match(/<a href="\/" class="brand"><img class="brand-logo" src="(\/public\/logo\.png\?v=[0-9a-f]{10})" alt="" width="\d+" height="\d+">Sharevy<\/a>/);
    assert.ok(logo, 'brand link contains the logo image');
    const png = await fetch(app.base + logo[1]);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    const body = Buffer.from(await png.arrayBuffer());
    assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const c = new Client(app.base);
    await c.register('logo@corp.local');
    const id = await c.createSurvey([{ label: 'Q', type: 'text' }]);
    const form = (await new Client(app.base).request(`/s/${await c.shareToken(id)}`)).text;
    assert.match(form, /<span class="brand"><img class="brand-logo" src="\/public\/logo\.png\?v=[0-9a-f]{10}" alt=""[^>]*>Sharevy<\/span>/);
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

  test('serves the self-hosted IBM Plex Sans font referenced by the stylesheet', async () => {
    const css = await (await fetch(`${app.base}/public/style.css`)).text();
    assert.match(css, /font-family:\s*"IBM Plex Sans"/);
    const urls = [...css.matchAll(/url\("?(\/public\/fonts\/[^")]+\.woff2)"?\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 3, 'style.css declares the 400, 500 and 600 weights');
    for (const url of urls) {
      const font = await fetch(`${app.base}${url}`);
      assert.equal(font.status, 200, url);
      assert.equal(font.headers.get('content-type'), 'font/woff2');
      assert.match(font.headers.get('cache-control'), /immutable/);
      // Every WOFF2 file starts with the "wOF2" signature.
      assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString('latin1'), 'wOF2');
    }
    const home = (await new Client(app.base).request('/')).text;
    assert.match(home, /<link rel="preload" href="\/public\/fonts\/ibm-plex-sans-latin-400-normal\.woff2" as="font" type="font\/woff2" crossorigin>/);
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
    // Different devices (no shared cookie) behind the same IP still count against the IP limit.
    const fresh = () => new Client(app.base);
    assert.equal((await fresh().request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
    assert.equal((await fresh().request(`/s/${token}`, { method: 'POST', form: {} })).status, 303);
    const blocked = await fresh().request(`/s/${token}`, { method: 'POST', form: {} });
    assert.equal(blocked.status, 429);
    assert.match(blocked.text, /Too many responses/);
    assert.match((await creator.request(`/surveys/${id}`)).text, /Responses \(2\)/);
  });

  test('session ids are stored hashed, not as the cookie value', async () => {
    const c = new Client(app.base);
    await c.register('hash@corp.local');
    const raw = c.sid;
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

describe('results charts and key figures', () => {
  let app;
  let now = new Date(2026, 10, 16, 12, 0);
  before(async () => { app = await startApp({ now: () => now }); });
  after(() => app.close());

  const CHART_FIELDS = [
    { label: 'Comment', type: 'text' },
    { label: 'Department', type: 'radio', options: ['Ops', 'Admin', 'HR'] },
    { label: 'Days', type: 'checkbox', options: ['Mon', 'Wed', 'Fri'] },
    { label: 'Food', type: 'select', options: ['Any', 'Veggie'] },
  ];
  /** The summary card of one question, from its <h4> to the end of its section. */
  const card = (html, label) => html.match(new RegExp(`<h4>${label} [\\s\\S]*?</section>`))?.[0] ?? '';
  const kpi = (html, label) => html.match(new RegExp(`<div class="kpi"><dt>${label}</dt><dd class="kpi-value">([^<]*)</dd>(?:<dd class="kpi-sub">([^<]*)</dd>)?</div>`))?.slice(1);

  async function answered(fields, answers) {
    const c = new Client(app.base);
    await c.register(`charts${Math.random()}@corp.local`);
    const id = await c.createSurvey(fields);
    const token = await c.shareToken(id);
    const form = (await new Client(app.base).request(`/s/${token}`)).text;
    const names = [...new Set([...form.matchAll(/name="(f_[a-z0-9]+)"/g)].map((m) => m[1]))];
    for (const [respondentName, values] of answers) {
      const body = [['respondent_name', respondentName], ...values.map(([i, v]) => [names[i], v])];
      assert.equal((await new Client(app.base).request(`/s/${token}`, { method: 'POST', form: body })).status, 303);
    }
    return { c, id };
  }

  test('single-choice questions get a donut with counts and percentages', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const { c, id } = await answered(CHART_FIELDS, [
      ['Ana', [[1, 'Ops'], [2, 'Mon'], [2, 'Fri'], [3, 'Any']]],
      ['', [[1, 'HR'], [2, 'Fri']]],
      ['', [[1, 'Ops']]],
    ]);
    const html = (await c.request(`/surveys/${id}`)).text;

    const radio = card(html, 'Department');
    assert.match(radio, /<svg class="donut"[^>]*aria-hidden="true"/);
    const legend = [...radio.matchAll(/<li><span class="swatch slice-(\d)"><\/span><span class="legend-label">([^<]+)<\/span><span class="legend-value">([^<]+)<\/span><\/li>/g)]
      .map(([, slot, label, value]) => [slot, label, value]);
    assert.deepEqual(legend, [['1', 'Ops', '2 (67%)'], ['2', 'Admin', '0 (0%)'], ['3', 'HR', '1 (33%)']]);
    // Zero answers draw no slice; the others get one each, with a hover title.
    assert.equal([...radio.matchAll(/<circle class="donut-slice slice-\d"/g)].length, 2);
    assert.match(radio, /<title>Ops: 2 \(67%\)<\/title>/);
    assert.match(card(html, 'Food'), /<svg class="donut"/);

    // Multiple choice: bars, never a pie, with a note that shares can add up to more than 100%.
    const checkbox = card(html, 'Days');
    assert.doesNotMatch(checkbox, /donut/);
    const bars = [...checkbox.matchAll(/<span class="bar-label">([^<]+)<\/span><svg class="hbar"[^>]*>[\s\S]*?<\/svg><span class="bar-value">([^<]+)<\/span>/g)]
      .map(([, label, value]) => [label, value]);
    assert.deepEqual(bars, [['Mon', '1 (50%)'], ['Wed', '0 (0%)'], ['Fri', '2 (100%)']]);
    assert.match(checkbox, /<rect class="hbar-fill" width="100%"/);
    assert.match(checkbox, /more than one option/);

    assert.equal(card(html, 'Comment'), '', 'text questions get no chart');
  });

  test('single-choice questions with more than six options use bars instead of a donut', async () => {
    const options = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const { c, id } = await answered([{ label: 'Letter', type: 'radio', options }], [['', [[0, 'G']]]]);
    const letter = card((await c.request(`/surveys/${id}`)).text, 'Letter');
    assert.doesNotMatch(letter, /donut/);
    assert.match(letter, /<span class="bar-label">G<\/span><svg class="hbar"[\s\S]*?<span class="bar-value">1 \(100%\)<\/span>/);
  });

  test('the results show key figures: responses, named and anonymous, last response, days left', async () => {
    now = new Date(2026, 10, 16, 12, 0);
    const { c, id } = await answered(CHART_FIELDS, [['Ana', [[1, 'Ops']]], ['', [[1, 'HR']]], ['Luis', []]]);
    let html = (await c.request(`/surveys/${id}`)).text;
    const kpis = html.match(/<section id="responses"[\s\S]*?<dl class="kpis">/);
    assert.ok(kpis, 'key figures live inside the live-updated responses section');
    assert.deepEqual(kpi(html, 'Responses'), ['3', undefined]);
    assert.deepEqual(kpi(html, 'With a name'), ['2', '1 anonymous']);
    const newest = html.match(/<td data-label="Sent \(UTC\)" class="nowrap">(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
    const [, date, time] = newest;
    const shown = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));
    assert.deepEqual(kpi(html, 'Last response'), [shown, `${time} UTC`]);
    assert.deepEqual(kpi(html, 'Closing'), ['10 days left', 'Closes on Nov 26, 2026']);

    now = new Date(2026, 10, 25, 9, 0);
    assert.deepEqual(kpi((await c.request(`/surveys/${id}`)).text, 'Closing'), ['1 day left', 'Closes on Nov 26, 2026']);
    now = new Date(2026, 10, 26, 9, 0);
    assert.deepEqual(kpi((await c.request(`/surveys/${id}`)).text, 'Closing'), ['Last day', 'Closes on Nov 26, 2026']);
    now = new Date(2026, 10, 27, 9, 0);
    assert.deepEqual(kpi((await c.request(`/surveys/${id}`)).text, 'Closing'), ['Expired', 'Closed on Nov 26, 2026 (closing date passed)']);
    now = new Date(2026, 10, 16, 12, 0);
    const _csrf = await c.csrf();
    await c.request(`/surveys/${id}/toggle`, { method: 'POST', form: { _csrf } });
    assert.deepEqual(kpi((await c.request(`/surveys/${id}`)).text, 'Closing'), ['Closed', 'Closes on Nov 26, 2026']);

    const empty = new Client(app.base);
    await empty.register('kpi-empty@corp.local');
    const emptyId = await empty.createSurvey([{ label: 'Q', type: 'text' }]);
    html = (await empty.request(`/surveys/${emptyId}`)).text;
    assert.deepEqual(kpi(html, 'Responses'), ['0', undefined]);
    assert.deepEqual(kpi(html, 'Last response'), ['—', undefined]);
    assert.doesNotMatch(html, /class="donut|class="hbar/);
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

describe('language', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(() => app.close());

  const spanish = () => new Client(app.base, { language: 'es-ES' });
  /** The language menu: current code in the summary, one link per language named in that language. */
  const menu = (html) => html.match(/<div class="topbar-actions">.*?(<details class="lang-menu"[\s\S]*?<\/details>)<button type="button" class="theme-toggle"/s)?.[1];
  const menuLinks = (html) => [...(menu(html) ?? '').matchAll(/<a href="([^"]+)" hreflang="(\w+)" lang="(\w+)"( aria-current="true")?>([^<]+)<\/a>/g)]
    .map(([, href, hreflang, lang, current, name]) => ({ href: href.replaceAll('&amp;', '&'), hreflang, lang, current: Boolean(current), name }));
  const clientStrings = (html) => JSON.parse(html.match(/<script type="application\/json" id="i18n-client">([\s\S]*?)<\/script>/)[1]);

  async function spanishCreatorWithSurvey(email) {
    const c = spanish();
    await c.register(email, 'Ana');
    const _csrf = await c.csrf('/surveys/new');
    const created = await c.request('/surveys', {
      method: 'POST',
      form: { _csrf, title: 'Almuerzo', closes_on: '2099-11-26', fields_json: JSON.stringify([{ label: 'Comida', type: 'text', required: true }]) },
    });
    assert.equal(created.status, 303, created.text);
    const id = Number(created.location.match(/^\/surveys\/(\d+)/)[1]);
    return { c, id, token: await c.shareToken(id) };
  }

  test('Accept-Language: es renders public, creator and respondent pages in Spanish', async () => {
    const home = (await spanish().request('/')).text;
    assert.match(home, /<html lang="es">/);
    assert.match(home, /Crea una encuesta, comparte un enlace y ve las respuestas/);
    assert.match(home, /<title>Sharevy<\/title>/);
    const login = (await spanish().request('/login')).text;
    assert.match(login, /<title>Iniciar sesión · Sharevy<\/title>/);
    assert.match(login, /Contraseña/);

    const { c, id, token } = await spanishCreatorWithSurvey('es-pages@corp.local');
    const list = (await c.request('/surveys')).text;
    assert.match(list, /<h1>Mis encuestas<\/h1>/);
    assert.match(list, /0 respuestas/);
    assert.match((await c.request(`/surveys/${id}?msg=created`)).text, /Encuesta creada/);
    assert.match((await c.request(`/surveys/${id}`)).text, /Cierra el 26 nov 2099/);

    const form = (await spanish().request(`/s/${token}`)).text;
    assert.match(form, /<html lang="es">/);
    assert.match(form, /Abierta hasta el 26 nov 2099/);
    assert.match(form, /Enviar mis respuestas/);
    assert.doesNotMatch(form, /Mis encuestas/);
  });

  test('English stays the default for browsers that ask for any or another language', async () => {
    for (const language of [undefined, 'fr-FR']) {
      const home = (await new Client(app.base, { language }).request('/')).text;
      assert.match(home, /<html lang="en">/);
      assert.match(home, /Create a survey, share a link, and see the answers/);
    }
  });

  test('the language link saves the choice in a cookie and returns to the same page', async () => {
    const c = new Client(app.base);
    const res = await c.request('/lang/es?next=%2Fsurveys');
    assert.equal(res.status, 303);
    assert.equal(res.location, '/surveys');
    const cookie = res.headers.getSetCookie().find((h) => h.startsWith('sharevy_lang='));
    assert.match(cookie, /^sharevy_lang=es; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000$/);

    // The cookie wins over the browser setting (fetch sends "accept-language: *").
    assert.match((await c.request('/login')).text, /<html lang="es">[\s\S]*Iniciar sesión/);
    assert.equal((await c.request('/lang/en?next=%2Flogin')).location, '/login');
    assert.match((await c.request('/login')).text, /<html lang="en">[\s\S]*Log in/);

    assert.equal((await c.request('/lang/es?next=%2F%2Fevil.example')).location, '/');
    assert.equal((await c.request('/lang/es')).location, '/');
    const unknown = await new Client(app.base).request('/lang/fr');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.getSetCookie().length, 0);
  });

  test('the language menu sits next to the theme switch and lists every language in its own name', async () => {
    const english = new Client(app.base);
    await english.register('switch@corp.local');
    const id = await english.createSurvey([{ label: 'Q', type: 'text' }]);
    const token = await english.shareToken(id);

    const detail = (await english.request(`/surveys/${id}?msg=saved`)).text;
    assert.match(menu(detail), /<summary class="button lang-summary" aria-label="Language: English" title="Language: English"><svg class="icon"[^>]*>[\s\S]*?<\/svg><span>EN<\/span><\/summary>/);
    assert.deepEqual(menuLinks(detail), [
      { href: `/lang/en?next=%2Fsurveys%2F${id}%3Fmsg%3Dsaved`, hreflang: 'en', lang: 'en', current: true, name: 'English' },
      { href: `/lang/es?next=%2Fsurveys%2F${id}%3Fmsg%3Dsaved`, hreflang: 'es', lang: 'es', current: false, name: 'Español' },
    ]);
    assert.ok(menu((await new Client(app.base).request(`/s/${token}`)).text), 'respondent pages have the menu too');

    const es = spanish();
    const home = (await es.request('/')).text;
    assert.match(menu(home), /aria-label="Idioma: Español"[\s\S]*<span>ES<\/span>/);
    const respondentPage = (await es.request(`/s/${token}`)).text;
    assert.deepEqual(menuLinks(respondentPage).map(({ href, current, name }) => ({ href, current, name })), [
      { href: `/lang/en?next=%2Fs%2F${token}`, current: false, name: 'English' },
      { href: `/lang/es?next=%2Fs%2F${token}`, current: true, name: 'Español' },
    ]);
    assert.match(respondentPage, /data-theme-toggle aria-label="Cambiar al tema oscuro"/);

    // Every menu link goes through /lang, which only redirects inside the site.
    for (const { href } of menuLinks(respondentPage)) {
      const res = await new Client(app.base).request(href);
      assert.equal(res.status, 303);
      assert.equal(res.location, `/s/${token}`);
    }
  });

  test('validation messages and the CSV export follow the language', async () => {
    const { c, id, token } = await spanishCreatorWithSurvey('es-errors@corp.local');

    const invalid = await c.request('/surveys', { method: 'POST', form: { _csrf: await c.csrf(), title: '', fields_json: '[]' } });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /El título es obligatorio\./);
    assert.match(invalid.text, /Agrega al menos una pregunta\./);

    const respondent = spanish();
    const answer = await respondent.request(`/s/${token}`, { method: 'POST', form: { respondent_name: 'x'.repeat(101) } });
    assert.equal(answer.status, 422);
    assert.match(answer.text, /Este campo es obligatorio\./);
    assert.match(answer.text, /El nombre puede tener como máximo 100 caracteres\./);
    assert.match(answer.text, /Revisa estas 2 respuestas:/);

    const csv = (await c.request(`/surveys/${id}/export.csv`)).text;
    assert.equal(csv.split('\r\n')[0], 'ID de respuesta,Enviada el (UTC),Nombre,Comida');

    const missing = await spanish().request('/s/no-existe');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /Esta encuesta no existe/);
  });

  test('browser scripts receive their strings in a JSON data block', async () => {
    const english = clientStrings((await new Client(app.base).request('/')).text);
    assert.equal(english.copied, 'Copied!');
    assert.equal(english.themeToLight, 'Switch to light theme');
    const es = clientStrings((await spanish().request('/')).text);
    assert.equal(es.copied, '¡Copiado!');
    assert.equal(es.resultsUpdated, 'Resultados actualizados');
    assert.equal(es['builder.addQuestion'], 'Agregar una pregunta');
  });
});
