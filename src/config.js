export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DB_PATH ?? 'data/surveys.db',
    // Public base URL used to build share links (e.g. https://surveys.intranet.local).
    // When empty, the request Host header is used.
    baseUrl: (env.BASE_URL ?? '').replace(/\/+$/, ''),
    allowRegistration: env.ALLOW_REGISTRATION !== 'false',
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  };
}
