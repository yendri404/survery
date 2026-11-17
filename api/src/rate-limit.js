/**
 * Fixed-window, in-memory rate limiter. Good enough for a single-process server;
 * counters reset when the process restarts. A limit of 0 disables it.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }) {
  const entries = new Map();

  function current(key) {
    const entry = entries.get(key);
    if (entry && entry.resetAt > now()) return entry;
    entries.delete(key);
    return undefined;
  }

  function prune() {
    const t = now();
    for (const [key, entry] of entries) if (entry.resetAt <= t) entries.delete(key);
    // Still too many live keys: drop the oldest ones (Map keeps insertion order).
    for (const key of entries.keys()) {
      if (entries.size <= maxKeys) break;
      entries.delete(key);
    }
  }

  return {
    isLimited(key) {
      if (limit <= 0) return false;
      return (current(key)?.count ?? 0) >= limit;
    },
    hit(key) {
      if (limit <= 0) return;
      let entry = current(key);
      if (!entry) {
        entry = { count: 0, resetAt: now() + windowMs };
        entries.set(key, entry);
        if (entries.size > maxKeys) prune();
      }
      entry.count += 1;
    },
    reset(key) {
      entries.delete(key);
    },
    retryAfterSeconds(key) {
      const entry = current(key);
      return entry ? Math.max(1, Math.ceil((entry.resetAt - now()) / 1000)) : 0;
    },
  };
}

/** Client IP; honors X-Forwarded-For only when the app is explicitly behind a trusted proxy. */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
