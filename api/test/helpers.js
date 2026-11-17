import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';

/** Starts the API on a random local port with an in-memory database (or `dbPath`). */
export async function startApi(overrides = {}, { dbPath = ':memory:' } = {}) {
  const db = openDatabase(dbPath);
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

let deviceCounter = 0;
/** A valid X-Device-Id value (20-100 chars of [A-Za-z0-9_-]). */
export const newDeviceId = () => `device-${process.pid}-${Date.now()}-${++deviceCounter}`.padEnd(24, 'x');

/** JSON API client: remembers its bearer token and, optionally, a device id. */
export class Client {
  constructor(base, { deviceId } = {}) {
    this.base = base;
    this.token = null;
    this.deviceId = deviceId ?? null;
  }

  async request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.token && !h.authorization) h.authorization = `Bearer ${this.token}`;
    if (this.deviceId && !h['x-device-id']) h['x-device-id'] = this.deviceId;
    let payload;
    if (body !== undefined) {
      h['content-type'] ??= 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers: h, body: payload });
    const out = { status: res.status, headers: res.headers };
    if (raw) {
      out.bytes = Buffer.from(await res.arrayBuffer());
      out.text = out.bytes.toString('utf8');
      return out;
    }
    out.text = await res.text();
    out.json = /application\/json/.test(res.headers.get('content-type') ?? '') && out.text ? JSON.parse(out.text) : null;
    return out;
  }

  async register(email, name = 'Creator', password = 'secret123') {
    const res = await this.request('/auth/register', { method: 'POST', body: { name, email, password } });
    if (res.status === 201) this.token = res.json.token;
    return res;
  }

  async login(email, password = 'secret123') {
    const res = await this.request('/auth/login', { method: 'POST', body: { email, password } });
    if (res.status === 200) this.token = res.json.token;
    return res;
  }

  /** Creates a survey and returns its full JSON (id, publicToken, fields with ids...). */
  async createSurvey(fields, title = 'Workplace survey', extra = {}) {
    const res = await this.request('/surveys', { method: 'POST', body: { title, description: 'Internal', fields, ...extra } });
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    return res.json.survey;
  }
}

/** Public submission from a fresh device (or the given client). */
export function answer(base, publicToken, body = {}, client = new Client(base, { deviceId: newDeviceId() })) {
  return client.request(`/public/surveys/${publicToken}/responses`, { method: 'POST', body: { answers: {}, ...body } });
}

/** Opens a Server-Sent Events stream with fetch (Bearer header) and lets a test wait for text on it. */
export async function openEvents(url, token) {
  const controller = new AbortController();
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: controller.signal });
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
