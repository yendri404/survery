import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (the folder that holds api/ and data/). Relative paths are resolved from here, not the cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const fromRepo = (path) => (path === ':memory:' || isAbsolute(path) ? path : resolve(REPO_ROOT, path));

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    // Default: data/surveys.db at the repository root, whatever folder the server starts from.
    dbPath: fromRepo(env.DB_PATH ?? 'data/surveys.db'),
    // Public base URL used to build share links (e.g. https://surveys.intranet.local).
    // When empty, the request Host header is used.
    baseUrl: (env.BASE_URL ?? '').replace(/\/+$/, ''),
    allowRegistration: env.ALLOW_REGISTRATION !== 'false',
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    // Use X-Forwarded-For for the client IP (only when behind a reverse proxy you control).
    trustProxy: env.TRUST_PROXY === 'true',
    // Failed logins allowed per email+IP within the window before returning 429.
    loginMaxFailures: Number(env.LOGIN_MAX_FAILURES ?? 10),
    loginWindowMs: 15 * 60 * 1000,
    // Responses accepted per survey+IP within the window (0 disables the limit).
    submissionLimit: Number(env.SUBMISSION_LIMIT ?? 60),
    submissionWindowMs: 10 * 60 * 1000,
  };
}
