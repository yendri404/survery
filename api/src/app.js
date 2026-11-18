import { createServer } from 'node:http';
import { hashToken } from './auth.js';
import { ApiError } from './errors.js';
import { bearerToken, sendJson } from './http.js';
import { createLiveUpdates } from './live.js';
import { createRepo } from './repo.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerResultsRoutes } from './routes/results.js';
import { registerSurveyRoutes } from './routes/surveys.js';
import { localDateString } from './surveys.js';

/** Every endpoint lives under this versioned prefix; a breaking change gets /api/v2. */
export const API_PREFIX = '/api/v1';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  // Answers carry tokens and personal data: never store them in shared caches.
  'Cache-Control': 'no-store',
};

const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const CORS_HEADERS = 'Authorization, Content-Type, X-Device-Id';
const CORS_EXPOSED = 'Retry-After, Content-Disposition';

function compileRoute(method, path, handler, auth, admin) {
  const keys = [];
  const source = path.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler, auth, admin };
}

/**
 * The request target as a URL. Only plain paths are accepted: absolute-form ("http://host/..."),
 * scheme-relative ("//host/...") and backslash targets are refused, like the web server does, and
 * a target URL cannot parse answers 400 instead of escaping the error handling.
 */
function parseTarget(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
    throw new ApiError(400, 'error.malformedUrl');
  }
  try {
    return new URL(target, 'http://localhost');
  } catch {
    throw new ApiError(400, 'error.malformedUrl');
  }
}

export function createApp({ db, config }) {
  const repo = createRepo(db);
  const routes = [];
  /**
   * Registers a handler for `method` + `path` (relative to API_PREFIX). `auth: true` requires a
   * creator's Bearer token; `admin: true` requires an admin panel token (a different kind).
   */
  const route = (method, path, handler, { auth = false, admin = false } = {}) => routes.push(compileRoute(method, path, handler, auth, admin));
  // Injectable clock so tests can move time; `today` is the server's local calendar date.
  const now = config.now ?? (() => new Date());
  const today = () => localDateString(now());
  const live = createLiveUpdates();
  const deps = { route, repo, config, today, live };
  registerMetaRoutes(deps);
  registerAuthRoutes(deps);
  registerSurveyRoutes(deps);
  registerPublicRoutes(deps);
  registerResultsRoutes(deps);
  registerAdminRoutes(deps);

  /** Bearer token -> hashed -> unexpired session row -> ctx.user. */
  function loadSession(ctx) {
    const token = bearerToken(ctx.req);
    if (!token) return;
    const session = repo.getSession(hashToken(token));
    if (!session) return;
    const user = repo.findUserById(session.user_id);
    if (!user) return;
    ctx.session = session;
    ctx.user = { id: user.id, name: user.name, email: user.email };
  }

  function matchRoute(method, pathname) {
    const allowed = [];
    for (const r of routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      if (r.method !== method) {
        allowed.push(r.method);
        continue;
      }
      let params;
      try {
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      } catch {
        throw new ApiError(400, 'error.malformedUrl');
      }
      return { route: r, params };
    }
    if (allowed.length) {
      const err = new ApiError(405, 'error.methodNotAllowed');
      err.headers = { Allow: [...new Set(allowed)].join(', ') };
      throw err;
    }
    throw new ApiError(404, 'error.notFound');
  }

  /** CORS for configured browser origins. Requests without Origin (curl, mobile apps) need none. */
  function applyCors(req, res) {
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (!origin || !(config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', CORS_EXPOSED);
    return true;
  }

  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const corsAllowed = applyCors(req, res);
    const ctx = { req, res, url: null, params: {}, user: null, session: null };

    try {
      ctx.url = parseTarget(req.url);
      if (req.method === 'OPTIONS') {
        if (corsAllowed) {
          res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
          res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
          res.setHeader('Access-Control-Max-Age', '600');
        }
        res.writeHead(204);
        return res.end();
      }
      const { pathname } = ctx.url;
      if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) throw new ApiError(404, 'error.notFound');

      const { route: r, params } = matchRoute(req.method, pathname.slice(API_PREFIX.length) || '/');
      ctx.params = params;
      loadSession(ctx);
      if (r.auth && !ctx.user) throw new ApiError(401, 'error.unauthorized');
      // Admin token: a live session of the current admin row (a reset in the database ends it).
      const adminToken = r.admin ? bearerToken(req) : undefined;
      if (r.admin && !(adminToken && repo.getAdminSession(hashToken(adminToken)))) throw new ApiError(401, 'error.unauthorized');
      await r.handler(ctx);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(500, 'error.generic');
      if (!(err instanceof ApiError)) console.error(err);
      if (res.headersSent) return res.end();
      sendJson(res, apiError.status, apiError, apiError.headers);
    }
  });
}
