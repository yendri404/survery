import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (the folder that holds api/ and data/). Relative paths are resolved from here, not the cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const fromRepo = (path) => (path === ':memory:' || isAbsolute(path) ? path : resolve(REPO_ROOT, path));
const withoutTrailingSlash = (url) => url.trim().replace(/\/+$/, '');

/** Share links point here when WEB_BASE_URL is not set and no trusted proxy says which address the browser used. */
export const DEFAULT_WEB_BASE_URL = 'http://localhost:3000';

/** Hosts only this machine can reach (where the web proxy runs). */
export const isLoopback = (host) => ['127.0.0.1', '::1', 'localhost'].includes(host);

export function loadConfig(env = process.env) {
  // Behind the web proxy by default: only this machine reaches the API.
  const host = env.HOST ?? '127.0.0.1';
  return {
    port: Number(env.PORT ?? 3001),
    host,
    // Default: data/surveys.db at the repository root, whatever folder the server starts from.
    dbPath: fromRepo(env.DB_PATH ?? 'data/surveys.db'),
    // Address of the web client; share links and QR codes point to `${webBaseUrl}/s/<token>`.
    // BASE_URL (the setting of the single-server version) is still read as a fallback. Unset (null),
    // links follow the address the browser used (X-Forwarded-Host, only with trustProxy), else
    // DEFAULT_WEB_BASE_URL.
    webBaseUrl: env.WEB_BASE_URL || env.BASE_URL ? withoutTrailingSlash(env.WEB_BASE_URL || env.BASE_URL) : null,
    // Browser origins allowed to call the API (comma-separated; "*" allows any origin).
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map(withoutTrailingSlash).filter(Boolean),
    allowRegistration: env.ALLOW_REGISTRATION !== 'false',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    // Use X-Forwarded-For for the client IP. Default: on for a loopback host (only the web proxy,
    // which always overwrites the header, can reach the API); off when other clients can reach it.
    trustProxy: env.TRUST_PROXY === undefined ? isLoopback(host) : env.TRUST_PROXY === 'true',
    // Failed logins allowed per email+IP within the window before returning 429.
    loginMaxFailures: Number(env.LOGIN_MAX_FAILURES ?? 10),
    loginWindowMs: 15 * 60 * 1000,
    // Admin panel sessions are short: the master password opens every account.
    adminSessionTtlMs: 8 * 60 * 60 * 1000,
    // FUN=true|1|yes|on: the admin panel's login greets with a playful line instead of the plain one.
    fun: ['true', '1', 'yes', 'on'].includes(String(env.FUN ?? '').trim().toLowerCase()),
    // Responses accepted per survey+IP within the window (0 disables the limit).
    submissionLimit: Number(env.SUBMISSION_LIMIT ?? 60),
    submissionWindowMs: 10 * 60 * 1000,
  };
}
