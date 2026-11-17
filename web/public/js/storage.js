/**
 * Values this browser remembers (localStorage). Storage may be blocked (private mode, strict
 * settings); then each value lasts while the page is open.
 *
 * The creator's API token lives here, so any script running on this origin could read it. That is
 * accepted on purpose and kept small: the page loads no third-party code, builds the DOM without
 * innerHTML, and the Content-Security-Policy allows only this origin's own scripts. The token
 * expires after 7 days and "Log out" ends it on the server.
 */
export const KEYS = { token: 'sharevy-token', device: 'sharevy-device', lang: 'sharevy-lang', theme: 'sharevy-theme' };

const memory = new Map();

export function load(key) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function save(key, value) {
  memory.set(key, value);
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Kept in memory only.
  }
  if (value === null || value === undefined) memory.delete(key);
}

/**
 * Respondent device id: 32 random bytes as base64url (43 characters), made once and kept, so a
 * device answers each survey once. Only its hash is stored by the API.
 */
export function deviceId(pattern = /^[A-Za-z0-9_-]{20,100}$/) {
  const saved = load(KEYS.device);
  if (saved && pattern.test(saved)) return saved;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  save(KEYS.device, id);
  return id;
}
