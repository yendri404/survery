import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (the folder that holds api/ and data/). Relative paths are resolved from here, not the cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const fromRepo = (path) => (path === ':memory:' || isAbsolute(path) ? path : resolve(REPO_ROOT, path));
const withoutTrailingSlash = (url) => url.trim().replace(/\/+$/, '');

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
    // BASE_URL (the setting of the single-server version) is still read as a fallback.
    webBaseUrl: withoutTrailingSlash(env.WEB_BASE_URL || env.BASE_URL || 'http://localhost:3000'),
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
    // Responses accepted per survey+IP within the window (0 disables the limit).
    submissionLimit: Number(env.SUBMISSION_LIMIT ?? 60),
    submissionWindowMs: 10 * 60 * 1000,
  };
}
