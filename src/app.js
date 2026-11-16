import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hashSessionId } from './auth.js';
import { HttpError, parseCookies, sendHtml } from './http.js';
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
  'theme.js': 'text/javascript; charset=utf-8',
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
  const publicDir = new URL('../public/', import.meta.url);
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
  const deps = { route, repo, config, views, today };
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
        throw new HttpError(400, 'Malformed URL.');
      }
      return { handler: r.handler, params };
    }
    throw pathMatched ? new HttpError(405, 'Method not allowed.') : new HttpError(404, 'Page not found.');
  }

  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const ctx = { req, res, url: new URL(req.url, 'http://localhost'), params: {}, user: null, session: null };

    try {
      if (req.method === 'GET' && ctx.url.pathname.startsWith('/public/')) {
        const asset = assets.get(ctx.url.pathname.slice('/public/'.length));
        if (!asset) throw new HttpError(404, 'Not found.');
        // Versioned URLs (?v=<hash>) never change content, so browsers may cache them for a year.
        const cache = ctx.url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
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
        status,
        message: status === 500 ? 'Something went wrong. Please try again.' : err.message,
        user: respondent ? null : ctx.user,
        csrf: ctx.session?.csrf_token,
        respondent,
      }));
    }
  });
}
