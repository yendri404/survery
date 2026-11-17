import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hashSessionId } from './auth.js';
import { HttpError, parseCookies, sendHtml } from './http.js';
import { LANGUAGE_COOKIE, createI18n, negotiateLanguage } from './i18n.js';
import { createLiveUpdates } from './live.js';
import { createRepo } from './repo.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerSurveyRoutes } from './routes/surveys.js';
import { localDateString } from './surveys.js';
import * as views from './views.js';

const ASSET_TYPES = {
  'style.css': 'text/css; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'builder.js': 'text/javascript; charset=utf-8',
  'favicon.svg': 'image/svg+xml',
  'logo.png': 'image/png',
  'theme.js': 'text/javascript; charset=utf-8',
  // IBM Plex Sans (OFL-1.1, see public/fonts/LICENSE-IBM-Plex.txt): latin subset, self-hosted.
  'fonts/ibm-plex-sans-latin-400-normal.woff2': 'font/woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2': 'font/woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function compileRoute(method, path, handler) {
  const keys = [];
  const source = path.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
}

export function createApp({ db, config }) {
  const repo = createRepo(db);
  const publicDir = new URL('../../public/', import.meta.url);
  const assets = new Map(
    Object.entries(ASSET_TYPES).map(([name, type]) => [name, { type, body: readFileSync(new URL(name, publicDir)) }]),
  );

  views.setAssetVersions(Object.fromEntries(
    [...assets].map(([name, a]) => [name, createHash('sha256').update(a.body).digest('hex').slice(0, 10)]),
  ));

  const routes = [];
  const route = (method, path, handler) => routes.push(compileRoute(method, path, handler));
  // Injectable clock so tests can move time; `today` is the server's local calendar date.
  const now = config.now ?? (() => new Date());
  const today = () => localDateString(now());
  const live = createLiveUpdates();
  // What every page needs from the request: its language, and its own URL for the language switch.
  const ui = (ctx) => ({ i18n: ctx.i18n, currentPath: ctx.url.pathname + ctx.url.search });
  const deps = { route, repo, config, views, today, live, ui };
  registerAuthRoutes(deps);
  registerSurveyRoutes(deps);
  registerPublicRoutes(deps);

  function loadSession(ctx) {
    const sid = parseCookies(ctx.req.headers.cookie).sid;
    if (!sid) return;
    const session = repo.getSession(hashSessionId(sid));
    if (!session) return;
    const user = repo.findUserById(session.user_id);
    if (!user) return;
    ctx.session = session;
    ctx.user = { id: user.id, name: user.name, email: user.email };
  }

  function matchRoute(method, pathname) {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      let params;
      try {
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      } catch {
        throw new HttpError(400, 'error.malformedUrl');
      }
      return { handler: r.handler, params };
    }
    throw pathMatched ? new HttpError(405, 'error.methodNotAllowed') : new HttpError(404, 'error.pageNotFound');
  }

  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const ctx = { req, res, url: new URL(req.url, 'http://localhost'), params: {}, user: null, session: null };
    ctx.i18n = createI18n(negotiateLanguage(parseCookies(req.headers.cookie)[LANGUAGE_COOKIE], req.headers['accept-language']));

    try {
      if (req.method === 'GET' && ctx.url.pathname.startsWith('/public/')) {
        const asset = assets.get(ctx.url.pathname.slice('/public/'.length));
        if (!asset) throw new HttpError(404, 'error.notFound');
        // Versioned URLs (?v=<hash>) never change content, so browsers may cache them for a year.
        // Fonts are linked from style.css without a version: a font file never changes (a new
        // version would get a new file name), so it is cached the same way.
        const immutable = ctx.url.searchParams.has('v') || asset.type === 'font/woff2';
        const cache = immutable ?'public, max-age=31536000, immutable' : 'public, max-age=300';
        res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': cache });
        return res.end(asset.body);
      }
      if (req.method === 'GET' && ctx.url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
      }

      loadSession(ctx);
      const { handler, params } = matchRoute(req.method, ctx.url.pathname);
      ctx.params = params;
      await handler(ctx);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      const respondent = err.respondent || ctx.url.pathname.startsWith('/s/');
      sendHtml(res, status, views.errorPage({
        ...ui(ctx),
        status,
        message: status === 500 ? ctx.i18n.t('error.generic') : ctx.i18n.t(err.key, err.params),
        user: respondent ? null : ctx.user,
        csrf: ctx.session?.csrf_token,
        respondent,
      }));
    }
  });
}
