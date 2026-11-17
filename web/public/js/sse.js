/**
 * Server-Sent Events read with fetch, so the Bearer token travels in a header (EventSource cannot
 * send headers). The parser is pure; `followEvents` keeps one stream open and reconnects.
 */

/** Incremental parser: push text chunks, get `{ event, data }` for each complete message. */
export function createSseParser(onMessage) {
  let buffer = '';
  let event = '';
  let data = [];
  const parser = {
    retry: undefined,
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop(); // an unfinished line waits for the next chunk
      for (const line of lines) {
        if (line === '') {
          if (data.length) onMessage({ event: event || 'message', data: data.join('\n') });
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue; // comment, such as ": ping"
        const colon = line.indexOf(':');
        const name = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (name === 'event') event = value;
        else if (name === 'data') data.push(value);
        else if (name === 'retry' && /^\d+$/.test(value)) parser.retry = Number(value);
      }
    },
  };
  return parser;
}

const MAX_DELAY_MS = 30_000;

/** Wait before reconnection attempt `attempt` (0 = first): doubles each time, up to 30 s. */
export const backoffDelay = (attempt, retryMs = 3000) => Math.min(retryMs * 2 ** attempt, MAX_DELAY_MS);

/**
 * Follows an event stream until `signal` aborts. `headers()` is read on each connection (the
 * token may change). `onChange` runs for each "change" event, and once after a reconnection,
 * because changes may have been missed while disconnected. A 401 calls `onUnauthorized` and stops.
 */
export function followEvents({ url, headers = () => ({}), onChange, onUnauthorized, signal, fetchImpl = (...args) => fetch(...args) }) {
  let attempt = 0;
  let retryMs = 3000;
  let connectedBefore = false;

  const wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  (async () => {
    while (!signal?.aborted) {
      try {
        const res = await fetchImpl(url, { headers: { Accept: 'text/event-stream', ...headers() }, cache: 'no-store', signal });
        if (res.status === 401) {
          onUnauthorized?.();
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream answered ${res.status}`);
        if (connectedBefore) onChange?.();
        connectedBefore = true;
        attempt = 0;
        const parser = createSseParser(({ event }) => { if (event === 'change') onChange?.(); });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
          if (parser.retry) retryMs = parser.retry;
        }
      } catch {
        if (signal?.aborted) return;
      }
      await wait(backoffDelay(attempt, retryMs));
      attempt += 1;
    }
  })();
}
