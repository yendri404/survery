import { h } from '../dom.js';
import { icon } from './icons.js';

/*
 * Presentational building blocks shared by every page: pure functions from data to DOM, with the
 * classes, ids and roles that style.css styles.
 * Event handlers come in as arguments; these functions never fetch or navigate on their own.
 */

export const APP_NAME = 'Sharevy';

/** Theme switch: shows a moon in light mode and a sun in dark mode (CSS); its label names the next theme. */
export const themeToggle = ({ label, onToggle }) => h('button', {
  type: 'button', class: 'theme-toggle', 'data-theme-toggle': true, 'aria-label': label, title: label, onclick: onToggle,
}, icon('moon', 'icon-moon'), icon('sun', 'icon-sun'));

/**
 * Language menu: a native <details> (opens with click, Enter or Space); one link per language,
 * named in its own language. `onPick(code)` switches without leaving the page.
 */
export function languageMenu({ t, lang, languages, href, onPick }) {
  const label = t('language.menuLabel', { name: t('language.name') });
  const links = Object.entries(languages).map(([code, name]) => h('li', {},
    h('a', {
      href, hreflang: code, lang: code, 'aria-current': code === lang ? 'true' : undefined,
      onclick: (event) => { event.preventDefault(); onPick(code, event.currentTarget.closest('details')); },
    }, name)));
  return h('details', { class: 'lang-menu', 'data-lang-menu': true },
    h('summary', { class: 'button lang-summary', 'aria-label': label, title: label }, icon('globe'), h('span', {}, t('language.code'))),
    h('ul', { class: 'lang-list' }, links));
}

/** Top bar. The brand always links home; respondents get no account menu: they never need an account. */
export function topbar({ t, user, respondent, languageMenuNode, themeToggleNode, onLogout }) {
  const logo = h('img', { class: 'brand-logo', src: '/public/logo.png', alt: '', width: 32, height: 32 });
  const brand = h('a', { href: '/', class: 'brand' }, logo, APP_NAME);
  let nav = null;
  if (!respondent) {
    nav = user
      ? h('nav', { 'aria-label': t('nav.main') },
        h('a', { href: '/surveys' }, t('nav.mySurveys')),
        h('span', { class: 'who' }, user.name),
        h('form', { class: 'inline', onsubmit: (event) => { event.preventDefault(); onLogout(); } },
          h('button', { type: 'submit', class: 'link' }, icon('logout'), ` ${t('nav.logOut')}`)))
      : h('nav', { 'aria-label': t('nav.main') }, h('a', { href: '/login' }, t('nav.logIn')));
  }
  return h('div', { class: 'topbar-inner' }, brand, h('div', { class: 'topbar-actions' }, nav, languageMenuNode, themeToggleNode));
}

/** Confirmation after an action ("Survey created…"). */
export const flash = (text) => h('div', { class: 'flash', role: 'status' }, icon('check'), h('span', {}, text));

/** Problem list: a red box with an alert icon. Items are strings or nodes (links). */
export const errorList = (items) => (items?.length
  ? h('div', { class: 'errors', role: 'alert' }, icon('alert'), h('ul', {}, items.map((item) => h('li', {}, item))))
  : null);

/** Shown once when the server has a newer client than this tab runs (version.js). */
export const updateBanner = ({ t, onReload }) => h('div', { class: 'update-banner', role: 'status' },
  icon('refresh'), h('span', {}, t('update.available')),
  h('button', { type: 'button', class: 'secondary', onclick: onReload }, t('update.reload')));

export const notice = (iconName, ...content) => h('p', { class: 'notice' }, icon(iconName), h('span', {}, ...content));

export const backLink = (href, text) => h('a', { class: 'back', href }, icon('back'), ` ${text}`);

export const emptyState = (text, action) => h('div', { class: 'empty' }, icon('inbox'), h('p', {}, text), action);

const STATUS_BADGES = { open: ['open', 'status.open'], closed: ['closed', 'status.closed'], expired: ['closed', 'status.expired'] };
export const statusKey = (status) => STATUS_BADGES[status][1];
export const statusBadge = (status, t) => h('span', { class: `badge ${STATUS_BADGES[status][0]}` }, t(statusKey(status)));

/** "Closes on Nov 26, 2026" or "Closed on … (closing date passed)". */
export const closingText = (closesOn, status, { t, formatDate }) =>
  t(status === 'expired' ? 'status.closedOnPassed' : 'status.closesOn', { date: formatDate(closesOn) });

/** Centered message page (thanks, closed, errors). `ok` draws the green check that animates in. */
export const resultPanel = ({ iconName, ok = false, heading, children = [] }) =>
  h('div', { class: 'panel result' }, h('div', { class: ok ? 'result-icon ok' : 'result-icon' }, icon(iconName)), h('h1', {}, heading), ...children);

/** Error page content; respondents get no "start page" button (the app is not theirs). */
export const errorPanel = ({ t, message, respondent }) => resultPanel({
  iconName: 'alert',
  heading: t('error.heading'),
  children: [h('p', {}, message), respondent ? null : h('p', {}, h('a', { class: 'button', href: '/' }, t('error.home')))],
});
