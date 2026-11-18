import { ApiError } from './errors.js';

const BODY_LIMIT_BYTES = 1_000_000;

/**
 * Reads an application/json body and returns it as a plain object.
 * An empty body counts as `{}`; anything other than a JSON object is rejected.
 */
export async function readJson(req, limitBytes = BODY_LIMIT_BYTES) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new ApiError(413, 'error.bodyTooLarge');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (type !== 'application/json') {
    if (!text) return {};
    throw new ApiError(415, 'error.unsupportedMediaType');
  }
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'error.invalidJson');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'error.invalidBody');
  return body;
}

export function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

export function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

/** Bearer token of the Authorization header, or undefined. */
export function bearerToken(req) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization ?? ''));
  return match?.[1];
}

const FORWARDED_HOST = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/**
 * "proto://host[:port]" the client used, from X-Forwarded-Proto and X-Forwarded-Host (set by the web
 * proxy, which overwrites whatever the browser sent). Undefined when either is missing or malformed,
 * so a header can never put a path, credentials or another scheme into a link.
 */
export function forwardedOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').trim().toLowerCase();
  const host = String(req.headers['x-forwarded-host'] ?? '').trim();
  if (!['http', 'https'].includes(proto) || !FORWARDED_HOST.test(host)) return undefined;
  return `${proto}://${host}`;
}

/** "2026-11-17 10:00:00" (SQLite UTC) -> "2026-11-17T10:00:00Z" (ISO 8601). */
/**
 * `Content-Disposition` for a download named `name`: an ASCII `filename` (accents removed, for old
 * clients) and the exact UTF-8 `filename*` (RFC 6266 / RFC 5987), which browsers prefer.
 */
export function attachmentDisposition(name) {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export const isoUtc =(sqliteDate) => (sqliteDate ? `${sqliteDate.replace(' ', 'T')}Z` : null);
