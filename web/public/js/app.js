import { ApiError, createApi } from './api.js';
import { errorPanel, flash, languageMenu, themeToggle, topbar, APP_NAME } from './components/layout.js';
import { h } from './dom.js';
import { errorMessage } from './errors.js';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, createI18n, pickLanguage } from './i18n.js';
import { coalesce, followEvents } from './sse.js';
import { KEYS, deviceId, load, save } from './storage.js';
import { matchRoute } from './routes.js';

// Confirmation messages shown after an action (?msg=<key>). Only known keys are shown.
const FLASH_MESSAGES = {
  created: 'flash.created',
  saved: 'flash.saved',
  closed: 'flash.closed',
  opened: 'flash.opened',
  'response-deleted': 'flash.responseDeleted',
  deleted: 'flash.deleted',
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function fetchLocale(lang) {
  const res = await fetch(`/locales/${lang}.json`);
  if (!res.ok) throw new Error(`locale ${lang}: ${res.status}`);
  return res.json();
}

/**
 * The application shell: language, theme, session, router and the container that renders pages.
 * Pages (pages/*.js) are async functions `(app, route) -> { title, body, respondent?, redirect? }`.
 */
export async function startApp() {
  const root = document.documentElement;
  const header = document.querySelector('.topbar');
  const main = document.querySelector('main');
  const locales = {};
  let booted = false;

  const app = {
    user: null,
    meta: null,
    token: load(KEYS.token),
    i18n: null,
    languages: {},
  };

  async function useLanguage(lang) {
    locales[lang] ??= await fetchLocale(lang);
    locales[DEFAULT_LANGUAGE] ??= await fetchLocale(DEFAULT_LANGUAGE);
    app.i18n = createI18n(lang, locales[lang], locales[DEFAULT_LANGUAGE]);
    app.t = app.i18n.t;
    app.tn = app.i18n.tn;
    root.lang = app.i18n.lang;
  }

  app.api = createApi({
    getToken: () => app.token,
    onUnauthorized: () => {
      // The token expired or was ended elsewhere: forget it and ask to log in again.
      setSession(null);
      if (!booted) return; // during start-up the first render decides where to go
      const here = location.pathname + location.search;
      if (here !== '/login' && !here.startsWith('/login?')) navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
    },
  });

  function setSession(session) {
    app.token = session?.token ?? null;
    app.user = session?.user ?? null;
    save(KEYS.token, app.token);
  }
  app.setSession = setSession;
  app.rememberDevice = (id) => save(KEYS.device, id);
  app.deviceId = () => deviceId(new RegExp(app.meta?.deviceIdPattern ?? '^[A-Za-z0-9_-]{20,100}$'));
  app.error = (err, keys) => errorMessage(err instanceof ApiError ? err : { code: 'internal_error' }, app.t, keys);

  // ---------- Live updates: "something changed" events re-fetch only the region that shows it ----------
  let announcer;
  app.announce = (text) => {
    if (!announcer) {
      announcer = h('div', { class: 'visually-hidden', 'aria-live': 'polite' });
      document.body.append(announcer);
    }
    announcer.textContent = '';
    setTimeout(() => { announcer.textContent = text; }, 50);
  };

  /**
   * Keeps `region` up to date: after change events, `build()` makes fresh content; when it differs
   * from what is shown, it replaces it, flashes a highlight ring and announces it to screen readers.
   * A burst of events (many answers at once) costs one refresh, and refreshes never overlap.
   */
  app.liveRegion = (region, url, build, signal) => {
    const refresh = coalesce(async () => {
      if (signal.aborted) return;
      try {
        const fresh = h('div', {}, await build());
        if (signal.aborted || fresh.innerHTML === region.innerHTML) return;
        region.replaceChildren(...fresh.childNodes);
        region.classList.remove('live-updated');
        void region.offsetWidth; // restart the highlight animation
        region.classList.add('live-updated');
        app.announce(app.t('client.resultsUpdated'));
      } catch {
        // Network hiccup: the next event or reconnection triggers another refresh.
      }
    });
    followEvents({ url: `/api/v1${url}`, headers: app.api.authHeaders, onChange: refresh, onUnauthorized: () => app.api.get('/me').catch(() => {}), signal });
  };

  // ---------- Theme ----------
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () => root.dataset.theme ?? (prefersDark.matches ? 'dark' : 'light');
  const themeLabel = () => app.t(currentTheme() === 'dark' ? 'client.themeToLight' : 'client.themeToDark');
  function syncThemeLabels() {
    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      btn.setAttribute('aria-label', themeLabel());
      btn.title = themeLabel();
    }
  }
  prefersDark.addEventListener('change', syncThemeLabels);
  const toggleTheme = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    save(KEYS.theme, next);
    syncThemeLabels();
  };

  // ---------- Top bar ----------
  let currentRespondent = false;
  function renderTopbar(respondent = currentRespondent) {
    currentRespondent = respondent;
    header.replaceChildren(topbar({
      t: app.t,
      user: app.user,
      respondent,
      languageMenuNode: languageMenu({
        t: app.t,
        lang: app.i18n.lang,
        languages: app.languages,
        href: location.pathname + location.search,
        onPick: async (code, menu) => {
          menu.open = false;
          if (code !== app.i18n.lang) {
            save(KEYS.lang, code);
            await useLanguage(code);
            await render({ transition: false });
          }
          header.querySelector('.lang-summary')?.focus();
        },
      }),
      themeToggleNode: themeToggle({ label: themeLabel(), onToggle: toggleTheme }),
      onLogout: async () => {
        await app.api.post('/auth/logout').catch(() => {});
        setSession(null);
        navigate('/');
      },
    }));
  }

  // Language menu: close it on a click outside or on Escape, like other menus.
  document.addEventListener('click', (event) => {
    for (const menu of document.querySelectorAll('[data-lang-menu][open]')) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of document.querySelectorAll('[data-lang-menu][open]')) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });

  // ---------- Router ----------
  let pageController = new AbortController();
  let renderId = 0;

  async function render({ transition = true } = {}) {
    const id = ++renderId;
    pageController.abort(); // stops the previous page's event streams
    const controller = new AbortController();
    pageController = controller;
    const url = new URL(location.href);
    const match = matchRoute(url.pathname);
    let page;
    try {
      if (!match) {
        page = { status: 404, title: app.t('error.title', { status: 404 }), body: [errorPanel({ t: app.t, message: app.t('error.pageNotFound') })] };
      } else if (match.route.auth && !app.user) {
        page = { redirect: `/login?next=${encodeURIComponent(url.pathname + url.search)}` };
      } else {
        page = await match.route.page(app, { params: match.params, query: url.searchParams, signal: controller.signal });
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 401) return; // onUnauthorized already went to the login page
      const respondent = Boolean(match?.route.respondent);
      const status = err instanceof ApiError && err.status ? err.status : 500;
      if (!(err instanceof ApiError)) console.error(err);
      page = {
        respondent,
        title: app.t('error.title', { status }),
        body: [errorPanel({ t: app.t, respondent, message: app.error(err, match?.route.errorKeys) })],
      };
    }
    if (id !== renderId) return; // a newer navigation won
    if (page.redirect) {
      navigate(page.redirect, { replace: true });
      return;
    }
    const respondent = Boolean(page.respondent ?? match?.route.respondent);
    const flashKey = FLASH_MESSAGES[url.searchParams.get('msg')];
    const swap = () => {
      document.title = page.title && page.title !== APP_NAME ? `${page.title} · ${APP_NAME}` : APP_NAME;
      document.body.classList.toggle('respondent', respondent);
      renderTopbar(respondent);
      main.replaceChildren(...[flashKey ? flash(app.t(flashKey)) : null, ...page.body].filter(Boolean));
      if (transition) window.scrollTo(0, 0);
      page.mounted?.();
    };
    // Cross-page fade where supported (View Transitions); never for people who ask for reduced
    // motion, nor in a hidden tab (the browser would abort it). The page swaps either way.
    if (transition && document.startViewTransition && !reducedMotion() && document.visibilityState === 'visible') {
      const fade = document.startViewTransition(swap);
      fade.ready.catch(() => {});
      fade.finished.catch(() => {});
    } else {
      swap();
    }
  }

  function navigate(to, { replace = false } = {}) {
    const url = new URL(to, location.href);
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    return render();
  }
  app.navigate = navigate;
  app.render = render;

  // Links inside the app change the page without reloading it.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/public/')) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // in-page anchor
    event.preventDefault();
    navigate(url.pathname + url.search);
  });
  window.addEventListener('popstate', () => render());

  // Open the calendar when tapping anywhere on a date field, not only on its small icon.
  document.addEventListener('click', (event) => {
    const input = event.target.closest?.('input[type="date"]');
    if (!input || typeof input.showPicker !== 'function') return;
    try {
      input.showPicker();
    } catch {
      // Some browsers refuse outside a direct user gesture; the native picker still works.
    }
  });

  /** Shows the error page for a failed action (like a failed form post did). */
  app.showError = (err, respondent = document.body.classList.contains('respondent')) => {
    const status = err instanceof ApiError && err.status ? err.status : 500;
    if (status === 401) return; // onUnauthorized already went to the login page
    document.title = `${app.t('error.title', { status })} · ${APP_NAME}`;
    main.replaceChildren(errorPanel({ t: app.t, respondent, message: app.error(err) }));
    window.scrollTo(0, 0);
  };

  // ---------- Boot ----------
  for (const code of SUPPORTED_LANGUAGES) app.languages[code] = '';
  await useLanguage(pickLanguage(load(KEYS.lang), navigator.languages ?? [navigator.language]));
  try {
    const [meta, me] = await Promise.all([
      app.api.get('/meta'),
      app.token ? app.api.get('/me').catch((err) => { if (err.status === 401) return null; throw err; }) : null,
      ...SUPPORTED_LANGUAGES.map(async (code) => { locales[code] ??= await fetchLocale(code); }),
    ]);
    app.meta = meta;
    if (me) app.user = me.user;
    else setSession(null);
  } catch (err) {
    renderTopbar(false);
    document.title = APP_NAME;
    main.replaceChildren(errorPanel({ t: app.t, message: app.error(err) }));
    return;
  }
  for (const code of SUPPORTED_LANGUAGES) app.languages[code] = locales[code]['language.name'];
  booted = true;
  await render({ transition: false });
}

