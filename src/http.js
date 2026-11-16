export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

/** Reads an application/x-www-form-urlencoded body and returns URLSearchParams. */
export async function readForm(req, limitBytes = 1_000_000) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, 'Unsupported form encoding.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'The submitted form is too large.');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

/**
 * Only allow same-site relative paths as redirect targets.
 * Control characters, spaces and backslashes are rejected because browsers strip or
 * normalize them while parsing URLs ("/\t/evil.com" becomes "//evil.com").
 */
export function safeNext(value, fallback = '/surveys') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  if (/[\x00-\x20\x7f\\]/.test(value)) return fallback;
  const origin = 'http://same-site.invalid';
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.pathname + url.search : fallback;
  } catch {
    return fallback;
  }
}
