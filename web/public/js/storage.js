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

const ADMIN_TOKEN = 'sharevy-admin-token';

/**
 * The admin panel's token, kept only for this tab (sessionStorage): closing the tab forgets it, and
 * it never sits in localStorage next to the creator's token. Blocked storage: memory only.
 */
export function loadAdminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN) ?? memory.get(ADMIN_TOKEN) ?? null;
  } catch {
    return memory.get(ADMIN_TOKEN) ?? null;
  }
}

export function saveAdminToken(token) {
  if (token) memory.set(ADMIN_TOKEN, token);
  else memory.delete(ADMIN_TOKEN);
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN, token);
    else sessionStorage.removeItem(ADMIN_TOKEN);
  } catch {
    // Kept in memory only.
  }
}

/**
 * Keys of the answers view picked on one survey's results ('table' or 'byQuestion') and of the
 * question shown in the "by question" view. `scope` is 'survey:<id>' on the creator's page and
 * 'results:<token>' on public results, so each survey keeps its own choice.
 */
export const answersViewKeys = (scope) => ({ view: `sharevy-answers-view:${scope}`, question: `sharevy-answers-question:${scope}` });

/**
 * The remembered answers view of one survey, for a results page (container) to keep across live
 * refreshes: `state` ({ view, question }, null when never picked) and `onChange(change)`, which
 * updates and saves only the parts that changed. A view never picked keeps following the default.
 */
export function rememberedAnswersView(scope) {
  const keys = answersViewKeys(scope);
  const state = { view: load(keys.view), question: load(keys.question) };
  return {
    state,
    onChange: (change) => {
      for (const [part, value] of Object.entries(change)) {
        state[part] = value;
        save(keys[part], value);
      }
    },
  };
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
