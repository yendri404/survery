/** Small pure helpers for dates and URLs. */

/**
 * Date and time parts of an ISO timestamp in a time zone (default: the viewer's own), as
 * zero-padded strings. Undefined `timeZone` means the browser's local zone.
 */
function zonedParts(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** "2026-11-17T10:05:00Z" -> "2026-11-17 06:05:00" in the viewer's time zone (here UTC-4). */
export function formatTimestamp(iso, timeZone) {
  if (!iso) return '';
  const p = zonedParts(iso, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** { date: 'YYYY-MM-DD', time: 'HH:MM' } of a timestamp in the viewer's time zone, or null. */
export function localDateTime(iso, timeZone) {
  if (!iso) return null;
  const p = zonedParts(iso, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The viewer's IANA time zone (e.g. "America/Caracas"), sent with CSV exports. */
export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

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
