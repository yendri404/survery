import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, relative as relativePath, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { normalizeBaseUrl, pagePreview, requestOrigin, withPreview } from './preview.js';

/** The web/ folder: index.html, public/ (served at /public/) and locales/ (served at /locales/). */
export const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Pages of the single-page app. Any of them answers index.html; the browser router draws the page.
 * Other paths answer index.html too, with status 404, and the router shows "page not found".
 */
export const APP_ROUTES = [
  /^\/$/,
  /^\/login$/,
  /^\/register$/,
  /^\/surveys$/,
  /^\/surveys\/new$/,
  /^\/surveys\/\d+$/,
  /^\/surveys\/\d+\/edit$/,
  /^\/s\/[A-Za-z0-9_-]+$/,
  /^\/s\/[A-Za-z0-9_-]+\/thanks$/,
  /^\/r\/[A-Za-z0-9_-]+$/,
  /^\/\.\.command\/?$/,
  /^\/\.\.command\/surveys\/\d+\/edit$/,
];

/** A share link (the survey form): its preview shows the survey's own title. */
const SHARE_PAGE = /^\/s\/([A-Za-z0-9_-]+)$/;

/** How long a page waits for the survey of its preview before using the generic one. */
const PREVIEW_TIMEOUT_MS = 2000;

/** URL prefix -> folder (inside WEB_ROOT) whose files it serves. */
const STATIC_DIRS = { '/public/': 'public', '/locales/': 'locales' };

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/*
 * No inline script or style. `blob:` images are the QR
 * code, which the page fetches with the Bearer token; `connect-src 'self'` covers the API, which
 * this server forwards under /api, so the browser talks to one origin only.
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

// Headers that belong to one connection, never forwarded by a proxy (RFC 9110, section 7.6.1).
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

const withoutHopByHop = (headers) => Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())));

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS, ...headers });
  res.end(text);
}

/**
 * Fingerprint of the client files (index.html, public/, locales/), read once at start-up. Every answer
 * carries it in `X-Sharevy-Version`, proxied API calls included, so a tab still running the previous
 * client notices an update (new modules, new texts) and reloads before showing a page built with
 * both. Deploying means restarting this server, which computes it again.
 */
export function clientVersion(root = WEB_ROOT) {
  const hash = createHash('sha256');
  const files = [resolve(root, 'index.html')];
  for (const dir of Object.values(STATIC_DIRS)) {
    try {
      const base = resolve(root, dir);
      for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
      }
    } catch {
      // A missing folder simply adds nothing.
    }
  }
  for (const file of files.map((f) => relativePath(root, f).split(sep).join('/')).sort()) {
    hash.update(file).update('\0');
    try {
      hash.update(readFileSync(resolve(root, file)));
    } catch {
      // Unreadable or missing (index.html in a bare test root): its name still counts.
    }
    hash.update('\0');
  }
  return hash.digest('base64url').slice(0, 22);
}

/**
 * Stops accepting requests and ends the open ones too: proxied event streams never finish on their
 * own, so waiting for them (plain `server.close()`) would keep the process alive forever.
 */
export function closeServer(server) {
  const closed = new Promise((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  return closed;
}

/**
 * Static web server for the browser client, plus a reverse proxy for the API.
 *
 * - `/api/*` is forwarded to `apiUrl` as is (method, body, status, headers, streamed event
 *   streams), so the page and the API share one origin: no CORS, and LAN links keep working.
 * - `/public/*` and `/locales/*` serve files from those folders only.
 * - App routes (APP_ROUTES) serve index.html; the client renders every page from JSON. Its <title>
 *   becomes the link preview tags (preview.js): a share link's survey title, else the generic one.
 *   URLs in them use `baseUrl` (WEB_BASE_URL), else the address the browser used.
 *
 * Without a build step, module URLs never change, so every file is served with
 * `Cache-Control: no-cache` and an ETag: the browser revalidates (a cheap 304) and never runs a
 * stale module. Fonts never change (a new version gets a new file name), so they are immutable.
 * A tab that was open before an update still holds the old modules in memory: `X-Sharevy-Version`
 * (clientVersion) lets it notice and reload.
 */
export function createWebServer({ apiUrl = 'http://127.0.0.1:3001', root = WEB_ROOT, baseUrl } = {}) {
  const api = new URL(apiUrl);
  const fixedOrigin = normalizeBaseUrl(baseUrl);
  const sendRequest = api.protocol === 'https:' ? httpsRequest : httpRequest;
  const fileCache = new Map(); // absolute path -> { mtimeMs, size, body, etag }
  const version = clientVersion(root);

  async function loadFile(path) {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    const cached = fileCache.get(path);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const body = await readFile(path);
    const entry = { mtimeMs: info.mtimeMs, size: info.size, body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"` };
    fileCache.set(path, entry);
    return entry;
  }

  /** Absolute path of a static URL, or undefined when it is not inside a static folder. */
  function staticPath(pathname) {
    const prefix = Object.keys(STATIC_DIRS).find((p) => pathname.startsWith(p));
    if (!prefix) return undefined;
    const dir = resolve(root, STATIC_DIRS[prefix]);
    let relative;
    try {
      relative = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return undefined;
    }
    // Decoded "..", backslashes and NUL never name a real asset: refuse them before touching the disk.
    if (!relative || relative.includes('\0') || relative.includes('\\') || relative.split('/').some((part) => part === '..' || part === '.')) return undefined;
    const full = resolve(dir, relative);
    return full.startsWith(dir + sep) ? full : undefined;
  }

  /** Sends a body with ETag revalidation (304 when the browser already holds this exact body). */
  function sendBody(req, res, { status, type, cache, body, etag }) {
    const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag, ...SECURITY_HEADERS };
    if (status === 200 && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(status, { ...headers, 'Content-Length': body.length });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function serveFile(req, res, path, status = 200) {
    let file;
    try {
      file = await loadFile(path);
    } catch {
      file = undefined;
    }
    if (!file) return sendText(res, 404, 'Not found.');
    const type = CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
    const cache = type === 'font/woff2' ? 'public, max-age=31536000, immutable' : 'no-cache';
    return sendBody(req, res, { status, type, cache, body: file.body, etag: file.etag });
  }

  /**
   * The survey behind a share link token, for its preview: asked to the API with no header from the
   * browser (no token, no device id). Undefined when it does not exist or the API is slow or down.
   */
  async function previewSurvey(token) {
    try {
      const res = await fetch(`${api.origin}/api/v1/public/surveys/${token}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
      });
      if (res.status !== 200) return undefined;
      const { survey } = await res.json();
      return survey && typeof survey.title === 'string' ? survey : undefined;
    } catch {
      return undefined;
    }
  }

  /** index.html with the page's link preview tags; its ETag follows the final body. */
  async function servePage(req, res, pathname, status) {
    let file;
    try {
      file = await loadFile(resolve(root, 'index.html'));
    } catch {
      file = undefined;
    }
    if (!file) return sendText(res, 404, 'Not found.');
    const token = status === 200 ? SHARE_PAGE.exec(pathname)?.[1] : undefined;
    const survey = token ? await previewSurvey(token) : undefined;
    const origin = requestOrigin(req.headers, fixedOrigin);
    const body = Buffer.from(withPreview(file.body.toString('utf8'), pagePreview({ survey, origin, pathname })));
    const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
    return sendBody(req, res, { status, type: CONTENT_TYPES['.html'], cache: 'no-cache', body, etag });
  }

  /** Forwards one request to the API and streams the answer back (event streams included). */
  function proxy(req, res, pathname, search) {
    // Always built on the configured API origin: nothing in the request may choose the host.
    const target = new URL(api.origin);
    target.pathname = pathname;
    target.search = search;
    const headers = {
      ...withoutHopByHop(req.headers),
      host: target.host,
      // The API trusts these only with TRUST_PROXY on. They are always overwritten here, never taken
      // from the browser: the real client address, and the address the browser used (the API builds
      // share links from it when WEB_BASE_URL is not set).
      'x-forwarded-for': req.socket.remoteAddress ?? '',
      'x-forwarded-host': req.headers.host ?? '',
      'x-forwarded-proto': 'http',
    };
    const upstream = sendRequest(target, { method: req.method, headers }, (apiRes) => {
      res.writeHead(apiRes.statusCode, withoutHopByHop(apiRes.headers));
      res.flushHeaders();
      res.socket?.setNoDelay(true); // events go out as soon as they are written
      // pipeline (not pipe): when the API drops the answer mid-way (restart, crash), the browser's
      // response is destroyed too, so an event stream ends and the client reconnects.
      pipeline(apiRes, res, () => {});
    });
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: { code: 'api_unavailable', message: 'The API server is not reachable.' } }));
    });
    // A closed browser tab ends the forwarded request too (and the API drops its event subscription).
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  return createServer(async (req, res) => {
    res.setHeader('X-Sharevy-Version', version); // merged into every writeHead below, proxy included
    // Only plain paths are accepted. Absolute-form ("http://host/..."), scheme-relative ("//host/...")
    // and backslash targets ("/\host/...", parsed like "//") could otherwise point the proxy at another host.
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) {
      return sendText(res, 400, 'Bad request.');
    }
    let pathname;
    let search;
    try {
      ({ pathname, search } = new URL(req.url, 'http://localhost'));
    } catch {
      return sendText(res, 400, 'Bad request.');
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) return proxy(req, res, pathname, search);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });

    if (Object.keys(STATIC_DIRS).some((prefix) => pathname.startsWith(prefix))) {
      const path = staticPath(pathname);
      return path ? serveFile(req, res, path) : sendText(res, 404, 'Not found.');
    }
    const known = APP_ROUTES.some((pattern) => pattern.test(pathname));
    return servePage(req, res, pathname, known ? 200 : 404);
  });
}
