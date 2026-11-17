/** Small pure helpers for dates and URLs. */

/** "2026-11-17T10:05:00Z" -> "2026-11-17 10:05:00" (UTC), the way answers were always listed. */
export const formatTimestamp = (iso) => (iso ? String(iso).replace('T', ' ').replace(/(\.\d+)?Z$/, '') : '');

/** Adds whole days to a YYYY-MM-DD date (pure calendar math, no time zone involved). */
export function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A same-site path to go back to after logging in; anything else (other sites, "//x") gives the list.
 * Control characters, spaces and backslashes are rejected because browsers strip or normalize them
 * while parsing URLs ("/\t/evil.com" becomes "//evil.com").
 */
export function safeNext(next, fallback = '/surveys') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/[\x00-\x20\x7f\\]/.test(next)) return fallback;
  return next;
}
