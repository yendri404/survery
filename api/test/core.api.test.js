import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { LIMITS } from '../src/surveys.js';
import { Client, rawRequest, startApi } from './helpers.js';

describe('API basics', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('health answers JSON', async () => {
    const res = await new Client(app.base).request('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'ok' });
  });

  test('every response is JSON with security headers', async () => {
    const res = await new Client(app.base).request('/health');
    assert.match(res.headers.get('content-type'), /^application\/json; charset=utf-8$/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });

  test('meta describes field types, limits and CSV options for clients', async () => {
    const res = await new Client(app.base).request('/meta');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.fieldTypes, ['text', 'textarea', 'number', 'scale', 'email', 'date', 'select', 'radio', 'yesno', 'checkbox']);
    assert.deepEqual(res.json.choiceTypes, ['select', 'radio', 'checkbox']);
    assert.deepEqual(res.json.yesNoValues, ['yes', 'no']);
    assert.deepEqual(res.json.limits, LIMITS);
    assert.equal(res.json.defaultOpenDays, 10);
    assert.deepEqual(res.json.csv, { delimiters: ['comma', 'semicolon', 'auto'], languages: ['en', 'es', 'pt'] });
    assert.equal(res.json.allowRegistration, true);
    assert.match(res.json.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(res.json.deviceIdPattern, '^[A-Za-z0-9_-]{20,100}$');
  });

  test('unknown paths give 404 not_found and wrong methods 405 method_not_allowed', async () => {
    const c = new Client(app.base);
    const missing = await c.request('/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not_found');
    assert.equal(typeof missing.json.error.message, 'string');
    const wrong = await c.request('/health', { method: 'DELETE' });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.json.error.code, 'method_not_allowed');
    assert.match(wrong.headers.get('allow'), /GET/);
    const outside = await fetch(`${app.base}/surveys`);
    assert.equal(outside.status, 404, 'only /api/v1 is served');
  });

  test('request targets that are not plain paths answer 400 malformed_url and the API keeps running', async () => {
    for (const target of ['http://[zz/', 'http://localhost/api/v1/health', '//localhost/api/v1/health', '/api/v1\\health']) {
      const res = await rawRequest(app.base, target);
      assert.equal(res.status, 400, target);
      assert.equal(res.json?.error.code, 'malformed_url', target);
    }
    const health = await new Client(app.base).request('/health');
    assert.equal(health.status, 200, 'the server survived');
  });

  test('bodies must be JSON objects within the size limit', async () => {
    const c = new Client(app.base);
    const form = await c.request('/auth/login', { method: 'POST', body: 'email=a', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    assert.equal(form.json.error.code, 'unsupported_media_type');
    const broken = await c.request('/auth/login', { method: 'POST', body: '{"email":' });
    assert.equal(broken.status, 400);
    assert.equal(broken.json.error.code, 'invalid_json');
    const array = await c.request('/auth/login', { method: 'POST', body: '[]' });
    assert.equal(array.status, 400);
    assert.equal(array.json.error.code, 'invalid_body');
    const huge = await c.request('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'x'.repeat(1_100_000) }) });
    assert.equal(huge.status, 413);
    assert.equal(huge.json.error.code, 'body_too_large');
  });
});

describe('CORS', () => {
  let app;
  before(async () => { app = await startApi({ corsOrigins: ['http://web.local:3000'] }); });
  after(() => app.close());

  test('preflight from an allowed origin lists methods and headers', async () => {
    const res = await fetch(`${app.base}/api/v1/surveys`, {
      method: 'OPTIONS',
      headers: { origin: 'http://web.local:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://web.local:3000');
    assert.match(res.headers.get('access-control-allow-methods'), /PATCH/);
    const allowed = res.headers.get('access-control-allow-headers').toLowerCase();
    for (const h of ['authorization', 'content-type', 'x-device-id']) assert.ok(allowed.includes(h), h);
    assert.match(res.headers.get('vary'), /Origin/);
  });

  test('responses to allowed origins expose Retry-After and Content-Disposition', async () => {
    const res = await fetch(`${app.base}/api/v1/health`, { headers: { origin: 'http://web.local:3000' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://web.local:3000');
    assert.match(res.headers.get('access-control-expose-headers'), /Retry-After/);
    assert.match(res.headers.get('access-control-expose-headers'), /Content-Disposition/);
  });

  test('other origins get no CORS headers', async () => {
    const res = await fetch(`${app.base}/api/v1/health`, { headers: { origin: 'http://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${app.base}/api/v1/health`, { method: 'OPTIONS', headers: { origin: 'http://evil.example' } });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });

  test('configuration reads PORT, WEB_BASE_URL and CORS_ORIGINS with sensible defaults', () => {
    const defaults = loadConfig({});
    assert.equal(defaults.port, 3001);
    assert.equal(defaults.webBaseUrl, null, 'unset: share links follow the address the browser used');
    assert.deepEqual(defaults.corsOrigins, ['http://localhost:3000']);
    const custom = loadConfig({ WEB_BASE_URL: 'https://surveys.local/', CORS_ORIGINS: 'https://a.local, https://b.local' });
    assert.equal(custom.webBaseUrl, 'https://surveys.local');
    assert.deepEqual(custom.corsOrigins, ['https://a.local', 'https://b.local']);
    assert.equal(loadConfig({ BASE_URL: 'https://legacy.local' }).webBaseUrl, 'https://legacy.local', 'BASE_URL still works as a fallback');
  });

  test('FUN is on only for true, 1, yes or on (any case); off when unset or anything else', () => {
    assert.equal(loadConfig({}).fun, false);
    for (const value of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) assert.equal(loadConfig({ FUN: value }).fun, true, value);
    for (const value of ['false', '0', 'no', 'off', '']) assert.equal(loadConfig({ FUN: value }).fun, false, value);
  });

  test('by default the API listens on loopback behind the web proxy and trusts its X-Forwarded-For', () => {
    const defaults = loadConfig({});
    assert.equal(defaults.host, '127.0.0.1');
    assert.equal(defaults.trustProxy, true, 'per-IP limits must count people, not the proxy');
    assert.equal(loadConfig({ HOST: '::1' }).trustProxy, true);
    assert.equal(loadConfig({ HOST: 'localhost' }).trustProxy, true);
    // Exposed to other clients: they could fake the header, so it is not trusted unless asked for.
    assert.equal(loadConfig({ HOST: '0.0.0.0' }).trustProxy, false);
    assert.equal(loadConfig({ HOST: '0.0.0.0', TRUST_PROXY: 'true' }).trustProxy, true, 'an explicit setting wins');
    assert.equal(loadConfig({ TRUST_PROXY: 'false' }).trustProxy, false, 'an explicit setting wins');
  });
});

describe('creator accounts', () => {
  let app;
  before(async () => { app = await startApi(); });
  after(() => app.close());

  test('register returns a bearer token and the user; /me needs it', async () => {
    const c = new Client(app.base);
    const reg = await c.register('ana@corp.local', 'Ana');
    assert.equal(reg.status, 201);
    assert.equal(typeof reg.json.token, 'string');
    assert.deepEqual(Object.keys(reg.json.user).sort(), ['email', 'id', 'name']);
    assert.equal(reg.json.user.name, 'Ana');

    const me = await c.request('/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, 'ana@corp.local');

    const anonymous = await new Client(app.base).request('/me');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, 'unauthorized');
    const forged = await new Client(app.base).request('/me', { headers: { authorization: 'Bearer forged' } });
    assert.equal(forged.status, 401);
  });

  test('logout ends the session; login again (email case-insensitive)', async () => {
    const c = new Client(app.base);
    await c.register('out@corp.local');
    const out = await c.request('/auth/logout', { method: 'POST' });
    assert.equal(out.status, 204);
    assert.equal((await c.request('/me')).status, 401);

    const bad = await c.login('out@corp.local', 'wrong-pass');
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error.code, 'invalid_credentials');
    const unknown = await c.login('nobody@corp.local');
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error.code, 'invalid_credentials');

    const ok = await c.login('OUT@corp.local');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.email, 'out@corp.local');
    assert.equal((await c.request('/me')).status, 200);
  });

  test('registration errors carry stable codes per field', async () => {
    await new Client(app.base).register('dup@corp.local');
    const again = await new Client(app.base).register('dup@corp.local');
    assert.equal(again.status, 422);
    assert.equal(again.json.error.code, 'validation_failed');
    assert.deepEqual(again.json.error.fields.email, { code: 'email_taken', params: {}, message: 'An account with this email already exists.' });

    const weak = await new Client(app.base).request('/auth/register', {
      method: 'POST', body: { name: '', email: 'not-an-email', password: 'short', confirm: 'other' },
    });
    assert.equal(weak.status, 422);
    const codes = Object.fromEntries(Object.entries(weak.json.error.fields).map(([k, v]) => [k, v.code]));
    assert.deepEqual(codes, { name: 'name_invalid', email: 'email_invalid', password: 'password_length', confirm: 'password_mismatch' });
  });

  test('tokens are stored hashed with a 7-day expiry', async () => {
    const c = new Client(app.base);
    await c.register('hash@corp.local');
    const rows = app.db.prepare('SELECT id, expires_at FROM sessions').all();
    assert.ok(rows.length > 0);
    assert.ok(!rows.some((r) => r.id === c.token));
    const mine = rows.at(-1);
    const week = 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(mine.expires_at - (Date.now() + week)) < 60_000);
  });
});

describe('login rate limiting', () => {
  let app;
  before(async () => { app = await startApi({ loginMaxFailures: 3 }); });
  after(() => app.close());

  test('blocked after repeated failures for the same email and IP', async () => {
    await new Client(app.base).register('brute@corp.local');
    const attacker = new Client(app.base);
    for (let i = 0; i < 3; i++) assert.equal((await attacker.login('brute@corp.local', 'wrong-pass')).status, 401);
    const blocked = await attacker.login('brute@corp.local');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'too_many_login_attempts');
    assert.equal(blocked.json.error.params.minutes, 15);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);

    await new Client(app.base).register('safe@corp.local');
    assert.equal((await attacker.login('safe@corp.local')).status, 200, 'other accounts are not affected');
  });

  test('wrong passwords sent all at once are counted before checking, so only the limit gets through', async () => {
    await new Client(app.base).register('burst@corp.local');
    const attacker = new Client(app.base);
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => attacker.login('burst@corp.local', `wrong-${i}`)));
    const statuses = burst.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 401).length, 3, statuses.join());
    assert.equal(statuses.filter((s) => s === 429).length, 9, statuses.join());
    assert.equal((await attacker.login('burst@corp.local')).status, 429, 'the right password waits too');
  });

  test('a correct login clears the failures counted before it', async () => {
    await new Client(app.base).register('typo@corp.local');
    const user = new Client(app.base);
    for (let i = 0; i < 2; i++) assert.equal((await user.login('typo@corp.local', 'wrong-pass')).status, 401);
    assert.equal((await user.login('typo@corp.local')).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await user.login('typo@corp.local', 'wrong-pass')).status, 401, `failure ${i + 1} after the reset`);
    assert.equal((await user.login('typo@corp.local')).status, 429);
  });
});

describe('registration disabled', () => {
  let app;
  before(async () => { app = await startApi({ allowRegistration: false }); });
  after(() => app.close());

  test('register returns 404 registration_disabled and meta says so', async () => {
    const res = await new Client(app.base).register('x@corp.local');
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'registration_disabled');
    assert.equal((await new Client(app.base).request('/meta')).json.allowRegistration, false);
  });
});
