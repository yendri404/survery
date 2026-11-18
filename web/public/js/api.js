/**
 * The only door to the REST API (docs/API.md). JSON in and out, the creator's token in an
 * `Authorization: Bearer` header, the respondent's device id in `X-Device-Id`.
 * Errors become ApiError with the API's stable `code` (translated by errors.js).
 */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(status, { code = 'internal_error', message = '', params = {}, fields, errors } = {}, retryAfter) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.params = params ?? {};
    this.fields = fields;
    this.errors = errors;
    this.retryAfter = retryAfter;
  }
}

/**
 * File name from `Content-Disposition`: the exact UTF-8 `filename*=UTF-8''...` when present (accents
 * kept), else the ASCII `filename="..."`, else `fallback`.
 */
function attachmentName(header, fallback) {
  const encoded = /filename\*=UTF-8''([^;\s]+)/i.exec(header ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Malformed encoding: fall back to the ASCII name.
    }
  }
  return /filename="([^"]+)"/.exec(header ?? '')?.[1] ?? fallback;
}

/**
 * `getToken()` gives the current token (or null). `onUnauthorized()` runs when the API rejects
 * a token that was sent (expired or ended elsewhere), so the app can ask to log in again.
 * `onVersion(value)` receives the `X-Sharevy-Version` header of every answer (version.js).
 */
export function createApi({ getToken, onUnauthorized, onVersion, fetchImpl = (...args) => fetch(...args) }) {
  async function send(path, { method = 'GET', body, deviceId, headers = {}, signal } = {}) {
    const h = { Accept: 'application/json', ...headers };
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    if (deviceId) h['X-Device-Id'] = deviceId;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new ApiError(0, { code: 'network_error' });
    }
    onVersion?.(res.headers.get('X-Sharevy-Version'));
    if (res.ok) return res;
    let error = {};
    try {
      error = (await res.json()).error ?? {};
    } catch {
      error = { code: res.status === 502 || res.status === 503 || res.status === 504 ? 'api_unavailable' : 'internal_error' };
    }
    const retry = Number(res.headers.get('Retry-After'));
    const apiError = new ApiError(res.status, error, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    if (res.status === 401 && token) onUnauthorized?.(apiError);
    throw apiError;
  }

  /** JSON body of the answer (null for 204). */
  async function request(path, options) {
    const res = await send(path, options);
    return res.status === 204 ? null : res.json();
  }

  return {
    request,
    get: (path, options) => request(path, options),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    del: (path, options) => request(path, { ...options, method: 'DELETE' }),
    /** A file (CSV, PNG, SVG) as a Blob, with the name the API suggests. */
    async file(path, fallbackName) {
      const res = await send(path, { headers: { Accept: '*/*' } });
      return { blob: await res.blob(), name: attachmentName(res.headers.get('Content-Disposition'), fallbackName) };
    },
    /** Headers for requests made outside this module (event streams). */
    authHeaders: () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
  };
}

/** Saves a Blob as a download (CSV, QR PNG): the API needs the Bearer header, so plain links cannot. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
