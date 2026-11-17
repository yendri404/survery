import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { closeServer, createWebServer } from '../server/app.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });

/** A fake API: records each request and answers according to its path. */
function stubApi() {
  const seen = [];
  const streams = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/api/v1/auth/login') {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '900' });
        return res.end('{"error":{"code":"too_many_login_attempts","message":"x","params":{"minutes":15}}}');
      }
      if (req.url.startsWith('/api/v1/surveys/7/export.csv')) {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sharevy-survey-7-responses.csv"' });
        return res.end('﻿Response ID\r\n');
      }
      if (req.url === '/api/v1/surveys/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
        res.write('retry: 3000\n: connected\n\n');
        streams.push(res);
        return undefined;
      }
      if (req.url === '/api/v1/surveys/9/events') {
        // The API drops the stream after one event (restart, crash): the socket goes away mid-body.
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
        res.write('event: change\ndata: 1\n\n');
        setTimeout(() => res.destroy(), 50);
        return undefined;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ echo: body }));
    });
  });
  return { server, seen, streams };
}

describe('web server', () => {
  let api;
  let web;
  let base;
  before(async () => {
    api = stubApi();
    const apiUrl = await listen(api.server);
    web = createWebServer({ apiUrl });
    base = await listen(web);
  });
  after(async () => {
    for (const res of api.streams) res.end();
    await close(web);
    await close(api.server);
  });

  test('request targets that are not plain paths are refused, so the proxy cannot reach other hosts', async () => {
    // A server standing for any other service on the network; it must never be reached through the proxy.
    let internalHits = 0;
    const internal = createServer((req, res) => { internalHits += 1; res.end('internal secret'); });
    const internalUrl = new URL(await listen(internal));
    const apiHitsBefore = api.seen.length;

    // Sends a raw HTTP request line, because fetch always normalizes the target to a plain path.
    const rawStatus = (target) => new Promise((resolve, reject) => {
      const { hostname, port } = new URL(base);
      const socket = connect(Number(port), hostname, () => {
        socket.write(`GET ${target} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => resolve(Number(data.split(' ')[1])));
      socket.on('error', reject);
    });

    try {
      for (const target of [
        `http://${internalUrl.host}/api/v1/health`, // absolute-form target
        `//${internalUrl.host}/api/v1/health`, // scheme-relative target
        `/\\${internalUrl.host}/api/v1/health`, // backslash, parsed like "//"
      ]) {
        assert.equal(await rawStatus(target), 400, target);
      }
      assert.equal(internalHits, 0, 'no request may reach another host');
      assert.equal(api.seen.length, apiHitsBefore, 'refused targets are not forwarded to the API either');
    } finally {
      await close(internal);
    }
  });

  test('app routes answer the single page with a strict CSP and security headers', async () => {
    for (const path of ['/', '/login', '/register', '/surveys', '/surveys/new', '/surveys/12', '/surveys/12/edit', '/s/AbC_-9', '/s/AbC_-9/thanks']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /^text\/html/);
      const html = await res.text();
      assert.match(html, /<script type="module" src="\/public\/js\/main\.js"><\/script>/);
      const csp = res.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'(;|$)/);
      assert.match(csp, /style-src 'self'(;|$)/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('cache-control'), 'no-cache');
    }
  });

  test('unknown pages get the single page (it shows "page not found") with status 404', async () => {
    for (const path of ['/nope', '/surveys/abc', '/surveys/1/edit/x', '/s/']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 404, path);
      assert.match(await res.text(), /src="\/public\/js\/main\.js"/);
    }
  });

  test('static files are revalidated with ETag (304), fonts are immutable', async () => {
    const css = await fetch(`${base}/public/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    assert.equal(css.headers.get('cache-control'), 'no-cache');
    const etag = css.headers.get('etag');
    assert.ok(etag);
    const again = await fetch(`${base}/public/style.css`, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    assert.equal(await again.text(), '');

    const js = await fetch(`${base}/public/theme.js`);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    const locale = await fetch(`${base}/locales/es.json`);
    assert.match(locale.headers.get('content-type'), /^application\/json/);
    assert.equal((await locale.json())['language.name'], 'Español');

    const font = await fetch(`${base}/public/fonts/ibm-plex-sans-latin-400-normal.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.match(font.headers.get('cache-control'), /immutable/);
  });

  test('paths outside the public folders are never served', async () => {
    const paths = ['/public/../server.js', '/public/%2e%2e/server.js', '/public/..%2fpackage.json', '/public/..%5cpackage.json',
      '/locales/../package.json', '/locales/%2e%2e%2fserver.js', '/public/fonts/%00.woff2', '/server.js', '/package.json', '/public/'];
    for (const path of paths) {
      const res = await fetch(base + path);
      const text = await res.text();
      assert.ok([400, 404].includes(res.status), `${path} -> ${res.status}`);
      assert.doesNotMatch(text, /createWebServer|sharevy-web/, path);
    }
  });

  test('only GET and HEAD reach static files and pages', async () => {
    const res = await fetch(`${base}/surveys`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
    const head = await fetch(`${base}/public/style.css`, { method: 'HEAD' });
    assert.equal(head.status, 200);
  });

  test('/api requests are forwarded with their body, status and headers', async () => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc', 'X-Forwarded-For': '6.6.6.6', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' },
      body: '{"email":"a@b.c"}',
    });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '900');
    assert.equal((await res.json()).error.code, 'too_many_login_attempts');
    const seen = api.seen.at(-1);
    assert.deepEqual([seen.method, seen.url, seen.body], ['POST', '/api/v1/auth/login', '{"email":"a@b.c"}']);
    assert.equal(seen.headers.authorization, 'Bearer abc');
    // The client cannot pick its own IP: the proxy reports the address it really sees.
    assert.equal(seen.headers['x-forwarded-for'], '127.0.0.1');
    // Nor the address it used: share links are built from the Host it really sent.
    assert.equal(seen.headers['x-forwarded-host'], new URL(base).host);
    assert.equal(seen.headers['x-forwarded-proto'], 'http');

    const csv = await fetch(`${base}/api/v1/surveys/7/export.csv?delimiter=semicolon&lang=es`);
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="sharevy-survey-7-responses.csv"');
    assert.equal(api.seen.at(-1).url, '/api/v1/surveys/7/export.csv?delimiter=semicolon&lang=es');
    // Bytes, not text(): text decoding drops the BOM that Excel needs.
    assert.deepEqual([...Buffer.from(await csv.arrayBuffer())], [...Buffer.from('﻿Response ID\r\n')]);
  });

  test('event streams pass through as they are written, without buffering', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/v1/surveys/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes(': connected')) text += decoder.decode((await reader.read()).value);
    api.streams.at(-1).write('event: change\ndata: 1\n\n');
    while (!text.includes('event: change')) text += decoder.decode((await reader.read()).value);
    controller.abort();
  });

  test('a stream the API drops mid-way ends for the browser too, so the client can reconnect', async () => {
    const res = await fetch(`${base}/api/v1/surveys/9/events`);
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    let timer;
    const ended = (async () => {
      try {
        for (;;) if ((await reader.read()).done) return 'ended';
      } catch {
        return 'ended'; // an aborted body also ends the read loop
      }
    })();
    const outcome = await Promise.race([ended, new Promise((resolve) => { timer = setTimeout(() => resolve('still open'), 2000); })]);
    clearTimeout(timer);
    if (outcome !== 'ended') await reader.cancel();
    assert.equal(outcome, 'ended');
  });

  test('shutting down closes open event streams instead of waiting for them', async () => {
    const own = createWebServer({ apiUrl: `http://127.0.0.1:${api.server.address().port}` });
    const ownBase = await listen(own);
    const res = await fetch(`${ownBase}/api/v1/surveys/events`);
    await res.body.getReader().read(); // the stream is open
    let timer;
    const outcome = await Promise.race([
      closeServer(own).then(() => 'closed'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('still open'), 2000); }),
    ]);
    clearTimeout(timer);
    assert.equal(outcome, 'closed');
  });

  test('an unreachable API answers 502 with a JSON error the client can translate', async () => {
    const down = createWebServer({ apiUrl: 'http://127.0.0.1:9' });
    const downBase = await listen(down);
    try {
      const res = await fetch(`${downBase}/api/v1/meta`);
      assert.equal(res.status, 502);
      assert.equal((await res.json()).error.code, 'api_unavailable');
    } finally {
      await close(down);
    }
  });
});
