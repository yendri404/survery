import { SUPPORTED_LANGUAGES, clientMessages, createI18n, defaultI18n } from './i18n.js';
import { LIMITS, YES_NO, answerText, daysBetween, fieldTypeLabels, summarize, surveyStatus } from './surveys.js';

export const APP_NAME = 'Sharevy';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/**
 * Translated text with trusted markup in it: the translation is escaped, then each {name} is
 * replaced by markup built here (which must already escape any user content it contains).
 */
const tHtml = (i18n, key, markup) => esc(i18n.t(key)).replace(/\{(\w+)\}/g, (match, name) => markup[name] ?? match);

/** Browser-script strings as a JSON data block. It is never executed, so the CSP allows it. */
const clientStringsBlock = (i18n) =>
  `<script type="application/json" id="i18n-client">${JSON.stringify(clientMessages(i18n)).replace(/</g, '\\u003c')}</script>`;

// Content hashes of public assets, set by app.js at startup, so URLs change whenever a file changes.
let assetVersions = {};
export const setAssetVersions = (versions) => { assetVersions = { ...versions }; };
const asset = (name) => `/public/${name}${assetVersions[name] ? `?v=${assetVersions[name]}` : ''}`;

const csrfInput = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

// Stroke icons drawn on a 24x24 grid. Inline SVG is allowed by the CSP (it is markup, not script).
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  alert: '<path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9s1.3-6.5 3.8-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};

export const icon = (name, extraClass = '') =>
  `<svg class="icon${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// Rendered hidden: public/app.js shows it and keeps its label in sync with the active theme.
const themeToggle = (i18n) => {
  const label = esc(i18n.t('client.themeToDark'));
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="${label}" title="${label}" hidden>${icon('moon', 'icon-moon')}${icon('sun', 'icon-sun')}</button>`;
};

/**
 * Language menu: one link per SUPPORTED_LANGUAGES entry, each named in its own language
 * ("English", "Español"), so a new locale shows up here on its own. A native <details> opens it
 * without JavaScript; public/app.js only adds "close on outside click / Escape".
 * /lang/<code> saves the choice and comes back to `currentPath`.
 */
function languageMenu(i18n, currentPath) {
  const next = encodeURIComponent(currentPath || '/');
  const label = esc(i18n.t('language.menuLabel', { name: i18n.t('language.name') }));
  const links = SUPPORTED_LANGUAGES.map((code) => {
    const current = code === i18n.lang ? ' aria-current="true"' : '';
    return `<li><a href="${esc(`/lang/${code}?next=${next}`)}" hreflang="${code}" lang="${code}"${current}>${esc(createI18n(code).t('language.name'))}</a></li>`;
  }).join('');
  return `<details class="lang-menu" data-lang-menu><summary class="button lang-summary" aria-label="${label}" title="${label}">${icon('globe')}<span>${esc(i18n.t('language.code'))}</span></summary><ul class="lang-list">${links}</ul></details>`;
}

// Confirmation messages shown after an action (?msg=<key>). Only known keys are rendered.
const FLASH_MESSAGES = {
  created: 'flash.created',
  saved: 'flash.saved',
  closed: 'flash.closed',
  opened: 'flash.opened',
  'response-deleted': 'flash.responseDeleted',
  deleted: 'flash.deleted',
};
export const flashMessage = (key, i18n = defaultI18n) =>
  (Object.hasOwn(FLASH_MESSAGES, key) ? i18n.t(FLASH_MESSAGES[key]) : undefined);

function layout({ title, body, user, csrf, flash, respondent = false, i18n = defaultI18n, currentPath = '/' }) {
  const { t } = i18n;
  const pageTitle = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
  let nav = '';
  if (!respondent) {
    nav = user
      ? `<nav aria-label="${esc(t('nav.main'))}">
          <a href="/surveys">${esc(t('nav.mySurveys'))}</a>
          <span class="who">${esc(user.name)}</span>
          <form method="post" action="/logout" class="inline">${csrfInput(csrf)}<button type="submit" class="link">${icon('logout')} ${esc(t('nav.logOut'))}</button></form>
        </nav>`
      : `<nav aria-label="${esc(t('nav.main'))}"><a href="/login">${esc(t('nav.logIn'))}</a></nav>`;
  }
  // The logo is decorative (alt=""): the name next to it already says what it is.
  const logo = `<img class="brand-logo" src="${asset('logo.png')}" alt="" width="32" height="32">`;
  const brand = respondent
    ? `<span class="brand">${logo}${APP_NAME}</span>`
    : `<a href="/" class="brand">${logo}${APP_NAME}</a>`;
  const flashHtml = flash ? `<div class="flash" role="status">${icon('check')}<span>${esc(flash)}</span></div>` : '';

  return `<!doctype html>
<html lang="${i18n.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1e2a3a">
<title>${esc(pageTitle)}</title>
<link rel="preload" href="/public/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${asset('style.css')}">
<script src="${asset('theme.js')}"></script>
${clientStringsBlock(i18n)}
</head>
<body${respondent ? ' class="respondent"' : ''}>
<header class="topbar"><div class="topbar-inner">${brand}<div class="topbar-actions">${nav}${languageMenu(i18n, currentPath)}${themeToggle(i18n)}</div></div></header>
<main>
${flashHtml}
${body}
</main>
<script src="${asset('app.js')}"></script>
</body>
</html>`;
}

function errorList(errors) {
  if (!errors?.length) return '';
  return `<div class="errors" role="alert">${icon('alert')}<ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul></div>`;
}
const escapedErrors = (errors) => errorList(errors?.map(esc));

const STATUS_BADGES = {
  open: ['open', 'status.open'],
  closed: ['closed', 'status.closed'],
  expired: ['closed', 'status.expired'],
};
const statusBadge = (status, i18n) => {
  const [className, key] = STATUS_BADGES[status];
  return `<span class="badge ${className}">${esc(i18n.t(key))}</span>`;
};

function closingText(survey, status, i18n) {
  const date = i18n.formatDate(survey.closesOn);
  return i18n.t(status === 'expired' ? 'status.closedOnPassed' : 'status.closesOn', { date });
}

export function homePage({ allowRegistration, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  const step = (n) => `<li>${tHtml(i18n, `home.step${n}`, { action: `<strong>${esc(t(`home.step${n}Action`))}</strong>` })}</li>`;
  return layout({
    title: APP_NAME,
    i18n,
    currentPath,
    body: `<section class="hero">
  <h1>${APP_NAME}</h1>
  <p class="lead">${esc(t('home.lead'))}</p>
  <ol class="steps">
    ${step(1)}
    ${step(2)}
    ${step(3)}
  </ol>
  <div class="button-row">
    <a class="button big" href="/login">${esc(t('home.logIn'))}</a>
    ${allowRegistration ? `<a class="button big secondary" href="/register">${esc(t('home.register'))}</a>` : ''}
  </div>
</section>`,
  });
}

export function loginPage({ next, email = '', error, allowRegistration, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  return layout({
    title: t('login.title'),
    i18n,
    currentPath,
    body: `<div class="panel narrow">
<h1>${esc(t('login.title'))}</h1>
<p class="muted">${esc(t('login.subtitle'))}</p>
${escapedErrors(error ? [error] : [])}
<form method="post" action="/login" class="stack">
  <input type="hidden" name="next" value="${esc(next)}">
  <label>${esc(t('form.email'))} <input type="email" name="email" value="${esc(email)}" required autofocus autocomplete="username" inputmode="email"></label>
  <label>${esc(t('form.password'))} <input type="password" name="password" required autocomplete="current-password"></label>
  <button type="submit" class="big">${esc(t('login.submit'))}</button>
</form>
${allowRegistration ? `<p>${tHtml(i18n, 'login.noAccount', { link: `<a href="/register">${esc(t('login.createOne'))}</a>` })}</p>` : ''}
</div>`,
  });
}

export function registerPage({ values = {}, errors = [], i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  return layout({
    title: t('register.title'),
    i18n,
    currentPath,
    body: `<div class="panel narrow">
<h1>${esc(t('register.title'))}</h1>
<p class="muted">${esc(t('register.subtitle'))}</p>
${escapedErrors(errors)}
<form method="post" action="/register" class="stack">
  <label>${esc(t('register.name'))} <input name="name" value="${esc(values.name)}" required maxlength="100" autocomplete="name"></label>
  <label>${esc(t('form.email'))} <input type="email" name="email" value="${esc(values.email)}" required maxlength="254" autocomplete="username" inputmode="email"></label>
  <label>${esc(t('form.password'))} <span class="hint">${esc(t('register.passwordHint'))}</span>
    <input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>
  <label>${esc(t('register.confirm'))} <input type="password" name="confirm" required minlength="8" maxlength="200" autocomplete="new-password"></label>
  <button type="submit" class="big">${esc(t('register.submit'))}</button>
</form>
<p>${tHtml(i18n, 'register.haveAccount', { link: `<a href="/login">${esc(t('register.logIn'))}</a>` })}</p>
</div>`,
  });
}

export function surveyListPage({ user, csrf, surveys, flash, today, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  const cards = surveys.map((s) => { const status = surveyStatus(s, today); return `<li>
    <a class="card card-link" href="/surveys/${s.id}">
      <span class="card-title">${esc(s.title)}</span>
      ${statusBadge(status, i18n)}
      <span class="muted">${esc(i18n.tn('list.responses', s.responseCount))} · ${esc(closingText(s, status, i18n))}</span>
    </a>
  </li>`; }).join('');
  return layout({
    title: t('list.title'),
    user,
    csrf,
    flash,
    i18n,
    currentPath,
    body: `<div class="page-head">
  <h1>${esc(t('list.title'))}</h1>
  <a class="button" href="/surveys/new">${icon('plus')} ${esc(t('list.newSurvey'))}</a>
</div>
<div id="survey-list" data-live="/surveys/events">
${surveys.length
    ? `<ul class="cards">${cards}</ul>`
    : `<div class="empty">${icon('inbox')}<p>${esc(t('list.empty'))}</p><a class="button big" href="/surveys/new">${icon('plus')} ${esc(t('list.createFirst'))}</a></div>`}
</div>`,
  });
}

export function surveyEditorPage({ user, csrf, survey, values, errors = [], today, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  // An expired survey keeps its past date valid until the creator changes it.
  const minDate = survey?.closesOn && survey.closesOn < today ? survey.closesOn : today;
  const editing = Boolean(survey);
  const action = editing ? `/surveys/${survey.id}` : '/surveys';
  const cancel = editing ? `/surveys/${survey.id}` : '/surveys';
  const warning = editing && survey.responseCount > 0
    ? `<p class="notice">${icon('alert')}<span>${esc(t('editor.hasAnswers', { count: survey.responseCount }))}</span></p>`
    : '';
  return layout({
    title: editing ? t('editor.editTitle', { title: survey.title }) : t('editor.newTitle'),
    user,
    csrf,
    i18n,
    currentPath,
    body: `<a class="back" href="${cancel}">${icon('back')} ${esc(t('editor.back'))}</a>
<h1>${esc(editing ? t('editor.editHeading') : t('editor.newTitle'))}</h1>
${warning}
${escapedErrors(errors)}
<form method="post" action="${action}" class="stack editor-form" id="survey-form" data-limits="${esc(JSON.stringify(LIMITS))}">
  ${csrfInput(csrf)}
  <section class="panel stack editor-basics">
    <h2>${esc(t('editor.basics'))}</h2>
    <label>${esc(t('editor.titleLabel'))} <input name="title" value="${esc(values.title)}" required maxlength="${LIMITS.title}" placeholder="${esc(t('editor.titlePlaceholder'))}"></label>
    <label>${esc(t('editor.description'))} <span class="hint">${esc(t('editor.descriptionHint'))}</span>
      <textarea name="description" rows="3" maxlength="${LIMITS.description}">${esc(values.description)}</textarea></label>
    <label>${esc(t('editor.closingDate'))} <span class="hint">${esc(t('editor.closingDateHint'))}</span>
      <input type="date" name="closes_on" value="${esc(values.closesOn)}" min="${esc(minDate)}" required></label>
  </section>
  <section class="stack editor-questions">
    <h2>${esc(t('editor.questions'))}</h2>
    <input type="hidden" name="fields_json" id="fields_json" value="${esc(values.fieldsJson)}">
    <div id="builder" data-types="${esc(JSON.stringify(fieldTypeLabels(t)))}"></div>
    <noscript><p class="errors">${esc(t('editor.noScript'))}</p></noscript>
  </section>
  <div class="form-footer">
    <button type="submit" class="big">${icon('check')} ${esc(editing ? t('editor.save') : t('editor.create'))}</button>
    <a class="button big secondary" href="${cancel}">${esc(t('editor.cancel'))}</a>
  </div>
</form>
<script src="${asset('builder.js')}"></script>`,
  });
}

/*
 * Charts for choice questions: server-rendered SVG, colored through CSS classes (.slice-1…6 use
 * the --cat-1…6 custom properties, with dark variants in style.css), so the CSP needs no inline
 * styles. The SVG is decorative (aria-hidden); the legend or bar labels next to it carry every
 * count and percentage as text, which is also what screen readers read.
 */
const MAX_DONUT_SLICES = 6; // categorical colors are never cycled; more options use bars
const DONUT_GAP = 0.6; // surface gap between slices, in percent of the circle
const fixed = (n) => Number(n.toFixed(2));
const percent = (count, answered) => (answered ? Math.round((count / answered) * 100) : 0);

/** Single choice (radio, select, yes/no): every answer picks one option, so the shares add up to 100%. */
function donutChart(counts, answered) {
  const drawn = counts.filter(({ count }) => count > 0).length; // the empty track shows only when nothing was chosen
  let start = 0;
  const slices = counts.map(({ label, count }, i) => {
    const share = answered ? (count / answered) * 100 : 0;
    const from = start;
    start += share;
    if (!count) return '';
    const length = Math.max(share - (drawn > 1 ? DONUT_GAP : 0), 0.01);
    // r = 15.9155 makes the circumference 100, so dash lengths are percentages; the offset of 25 starts at 12 o'clock.
    return `<circle class="donut-slice slice-${i + 1}" cx="21" cy="21" r="15.9155" stroke-dasharray="${fixed(length)} ${fixed(100 - length)}" stroke-dashoffset="${fixed(25 - from)}"><title>${esc(label)}: ${count} (${percent(count, answered)}%)</title></circle>`;
  }).join('');
  const legend = counts.map(({ label, count }, i) =>
    `<li><span class="swatch slice-${i + 1}"></span><span class="legend-label">${esc(label)}</span><span class="legend-value">${count} (${percent(count, answered)}%)</span></li>`).join('');
  return `<div class="donut-chart"><svg class="donut" viewBox="0 0 42 42" aria-hidden="true" focusable="false">${drawn ? '' : '<circle class="donut-track" cx="21" cy="21" r="15.9155"/>'}${slices}<text class="donut-total" x="21" y="21">${answered}</text></svg><ul class="legend">${legend}</ul></div>`;
}

/**
 * Horizontal bars. Multiple choice (checkbox) always uses them, never a pie: one person can pick
 * several options, so the percentages (of people who answered) add up to more than 100%, and a
 * pie would wrongly present them as parts of one whole.
 */
function barChart(counts, answered) {
  return `<ul class="hbars">${counts.map(({ label, count }) => {
    const pct = percent(count, answered);
    const fill = count ? `<rect class="hbar-fill" width="${fixed(answered ? (count / answered) * 100 : 0)}%" height="12"><title>${esc(label)}: ${count} (${pct}%)</title></rect>` : '';
    return `<li><span class="bar-label">${esc(label)}</span><svg class="hbar" width="100%" height="12" aria-hidden="true" focusable="false"><rect class="hbar-track" width="100%" height="12"/>${fill}</svg><span class="bar-value">${count} (${pct}%)</span></li>`;
  }).join('')}</ul>`;
}

function summaryHtml(fields, responses, i18n) {
  const items = summarize(fields, responses, { t: i18n.t });
  if (!items.length || !responses.length) return '';
  return `<h3>${esc(i18n.t('detail.summary'))}</h3><div class="charts">${items.map(({ field, answered, counts }) => {
    const multiple = field.type === 'checkbox';
    const chart = !multiple && counts.length <= MAX_DONUT_SLICES ? donutChart(counts, answered) : barChart(counts, answered);
    return `
<section class="panel summary">
  <h4>${esc(field.label)} <span class="muted">${esc(i18n.t('detail.answered', { count: answered }))}</span></h4>
  ${chart}
  ${multiple ? `<p class="hint">${esc(i18n.t('detail.chart.multipleNote'))}</p>` : ''}
</section>`;
  }).join('')}</div>`;
}

/** Key figures at the top of the results: they update live with the rest of #responses. */
function kpiTiles(survey, responses, status, today, i18n) {
  const { t } = i18n;
  const named = responses.filter((r) => r.respondentName).length;
  const newest = responses[0]?.submittedAt; // listResponses is newest first; "YYYY-MM-DD HH:MM:SS" UTC
  const daysLeft = daysBetween(today, survey.closesOn);
  const closing = status === 'open'
    ? (daysLeft > 0 ? i18n.tn('detail.kpi.daysLeft', daysLeft) : t('detail.kpi.lastDay'))
    : t(STATUS_BADGES[status][1]);
  const tile = (label, value, sub) =>
    `<div class="kpi"><dt>${esc(label)}</dt><dd class="kpi-value">${esc(value)}</dd>${sub ? `<dd class="kpi-sub">${esc(sub)}</dd>` : ''}</div>`;
  return `<dl class="kpis">${[
    tile(t('detail.kpi.responses'), String(responses.length)),
    tile(t('detail.kpi.named'), String(named), responses.length ? t('detail.kpi.anonymous', { count: responses.length - named }) : ''),
    tile(t('detail.kpi.lastResponse'), newest ? i18n.formatDate(newest.slice(0, 10)) : '—', newest ? `${newest.slice(11, 16)} UTC` : ''),
    tile(t('detail.kpi.closing'), closing, closingText(survey, status, i18n)),
  ].join('')}</dl>`;
}

export function surveyDetailPage({ user, csrf, survey, responses, shareUrl, qrSvg, flash, today, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  const status = surveyStatus(survey, today);
  const head = survey.fields.map((f) => `<th>${esc(f.label)}</th>`).join('');
  const rows = responses.map((r) => `<tr>
    <td data-label="${esc(t('detail.columnResponse'))}">#${r.id}</td>
    <td data-label="${esc(t('detail.columnSent'))}" class="nowrap">${esc(r.submittedAt)}</td>
    <td data-label="${esc(t('detail.columnName'))}">${r.respondentName ? esc(r.respondentName) : `<span class="muted">${esc(t('detail.anonymous'))}</span>`}</td>
    ${survey.fields.map((f) => `<td data-label="${esc(f.label)}">${esc(answerText(f, r.answers[f.id], t)) || '<span class="muted">-</span>'}</td>`).join('')}
    <td class="row-actions"><form method="post" action="/surveys/${survey.id}/responses/${r.id}/delete" data-confirm="${esc(t('detail.deleteResponseConfirm', { id: r.id }))}">${csrfInput(csrf)}
      <button type="submit" class="icon-button danger" aria-label="${esc(t('detail.deleteResponseLabel', { id: r.id }))}" title="${esc(t('detail.deleteResponseTitle'))}">${icon('trash')}</button></form></td>
  </tr>`).join('');
  const expiredLink = `<a href="/surveys/${survey.id}/edit">${esc(t('detail.expiredNoticeLink'))}</a>`;

  return layout({
    title: survey.title,
    user,
    csrf,
    flash,
    i18n,
    currentPath,
    body: `<a class="back" href="/surveys">${icon('back')} ${esc(t('detail.back'))}</a>
<h1>${esc(survey.title)} ${statusBadge(status, i18n)}</h1>
<p class="meta">${icon('calendar')} ${esc(closingText(survey, status, i18n))}</p>
${survey.description ? `<p class="description">${esc(survey.description)}</p>` : ''}

<div class="detail-layout">
<aside class="detail-side">
<section class="panel share">
  <h2>${icon('share')} ${esc(t('detail.shareHeading'))}</h2>
  <p>${esc(t('detail.shareText'))}</p>
  ${status === 'closed' ? `<p class="notice">${icon('lock')}<span>${esc(t('detail.closedNotice'))}</span></p>` : ''}
  ${status === 'expired' ? `<p class="notice">${icon('calendar')}<span>${tHtml(i18n, 'detail.expiredNotice', { link: expiredLink })}</span></p>` : ''}
  <input id="share-url" class="share-url" value="${esc(shareUrl)}" readonly aria-label="${esc(t('detail.shareLinkLabel'))}">
  <div class="button-row">
    <button type="button" data-copy="share-url">${icon('copy')} <span>${esc(t('detail.copyLink'))}</span></button>
    <button type="button" class="secondary" data-share="share-url" data-share-title="${esc(survey.title)}" hidden>${icon('share')} ${esc(t('detail.share'))}</button>
    <a class="button secondary" href="${esc(shareUrl)}" target="_blank" rel="noopener">${icon('open')} ${esc(t('detail.openForm'))}</a>
  </div>
  <div class="qr-block">
    <div class="qr">${qrSvg}</div>
    <div class="qr-help">
      <h3>${icon('qr')} ${esc(t('detail.qrHeading'))}</h3>
      <p>${esc(t('detail.qrText'))}</p>
      <a class="button secondary" href="/surveys/${survey.id}/qr.png">${icon('download')} ${esc(t('detail.qrDownload'))}</a>
    </div>
  </div>
</section>

<section class="panel">
  <h2>${esc(t('detail.manage'))}</h2>
  <div class="button-row">
    <a class="button secondary" href="/surveys/${survey.id}/edit">${icon('edit')} ${esc(t('detail.edit'))}</a>
    <form method="post" action="/surveys/${survey.id}/toggle" class="inline">${csrfInput(csrf)}
      ${survey.isOpen
    ? `<button type="submit" class="secondary">${icon('lock')} ${esc(t('detail.close'))}</button>`
    : `<button type="submit" class="secondary">${icon('unlock')} ${esc(t('detail.reopen'))}</button>`}
    </form>
    <form method="post" action="/surveys/${survey.id}/delete" class="inline" data-confirm="${esc(t('detail.deleteConfirm'))}">${csrfInput(csrf)}
      <button type="submit" class="danger">${icon('trash')} ${esc(t('detail.delete'))}</button>
    </form>
  </div>
  <p class="hint">${esc(t('detail.manageHint'))}</p>
</section>
</aside>

<div class="detail-main">
<section id="responses" data-live="/surveys/${survey.id}/events">
  <div class="page-head">
    <h2>${esc(t('detail.responses', { count: responses.length }))}</h2>
    <div class="button-row">
      <a class="button secondary" href="/surveys/${survey.id}/export.csv?delimiter=semicolon">${icon('download')} ${esc(t('detail.exportExcel'))}</a>
      <a class="button secondary" href="/surveys/${survey.id}/export.csv">${icon('download')} ${esc(t('detail.exportCsv'))}</a>
    </div>
  </div>
  ${kpiTiles(survey, responses, status, today, i18n)}
  ${summaryHtml(survey.fields, responses, i18n)}
  ${responses.length
    ? `<h3>${esc(t('detail.allAnswers'))}</h3><div class="table-wrap"><table class="responsive"><thead><tr><th>#</th><th>${esc(t('detail.columnSent'))}</th><th>${esc(t('detail.columnName'))}</th>${head}<th><span class="visually-hidden">${esc(t('detail.columnActions'))}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty">${icon('inbox')}<p>${esc(t('detail.noAnswers'))}</p></div>`}
</section>
</div>
</div>`,
  });
}

const INPUT_TYPES = { text: 'text', number: 'number', email: 'email', date: 'date' };
const INPUT_MODES = { number: 'decimal', email: 'email' };

function renderField(field, value, error, index, i18n) {
  const { t } = i18n;
  const name = `f_${field.id}`;
  const id = `fld_${field.id}`;
  const required = field.required ? ' required' : '';
  const mark = field.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const errorHtml = error ? `<p class="field-error" id="${id}_error">${icon('alert')} ${esc(error)}</p>` : '';
  const described = error ? ` aria-describedby="${id}_error" aria-invalid="true"` : '';
  const number = `<span class="q-number">${index + 1}.</span> `;
  // data-* attributes give public/app.js the rules it checks before sending (the server checks again).
  const rules = ` data-type="${esc(field.type)}"${field.required ? ' data-required' : ''} data-label="${esc(field.label)}"`;
  const wrap = (inner) => `<div class="field${error ? ' has-error' : ''}"${rules}>${inner}${errorHtml}</div>`;

  switch (field.type) {
    case 'radio':
    case 'checkbox': {
      const selected = Array.isArray(value) ? value : [value];
      const hint = field.type === 'checkbox' ? `<span class="hint">${esc(t('respond.chooseMany'))}</span>` : '';
      const inputs = field.options.map((option, i) => `<label class="choice">
        <input type="${field.type}" name="${name}" value="${esc(option)}"${selected.includes(option) ? ' checked' : ''}${field.type === 'radio' && i === 0 ? required : ''}>
        <span>${esc(option)}</span></label>`).join('');
      return wrap(`<fieldset id="${id}"${described}><legend>${number}${esc(field.label)}${mark}</legend>${hint}<div class="choices">${inputs}</div></fieldset>`);
    }
    case 'yesno': {
      // Two fixed choices; the stored value is always "yes" or "no", the text follows the language.
      const inputs = YES_NO.map((option, i) => `<label class="choice">
        <input type="radio" name="${name}" value="${option}"${value === option ? ' checked' : ''}${i === 0 ? required : ''}>
        <span>${esc(t(`answer.${option}`))}</span></label>`).join('');
      return wrap(`<fieldset id="${id}"${described}><legend>${number}${esc(field.label)}${mark}</legend><div class="choices yesno">${inputs}</div></fieldset>`);
    }
    case 'select': {
      const options = field.options.map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('');
      return wrap(`<label for="${id}">${number}${esc(field.label)}${mark}</label>
        <select id="${id}" name="${name}"${required}${described}><option value="">${esc(t('respond.chooseOption'))}</option>${options}</select>`);
    }
    case 'textarea':
      return wrap(`<label for="${id}">${number}${esc(field.label)}${mark}</label>
        <textarea id="${id}" name="${name}" rows="4" maxlength="${LIMITS.textarea}"${required}${described}>${esc(value)}</textarea>`);
    default: {
      const extra = field.type === 'number' ? ' step="any"' : field.type === 'text' ? ` maxlength="${LIMITS.text}"` : '';
      const mode = INPUT_MODES[field.type] ? ` inputmode="${INPUT_MODES[field.type]}"` : '';
      return wrap(`<label for="${id}">${number}${esc(field.label)}${mark}</label>
        <input id="${id}" type="${INPUT_TYPES[field.type] ?? 'text'}" name="${name}" value="${esc(value)}"${extra}${mode}${required}${described}>`);
    }
  }
}

function respondentNameField(value, error, i18n) {
  const { t } = i18n;
  const errorHtml = error ? `<p class="field-error" id="respondent_name_error">${icon('alert')} ${esc(error)}</p>` : '';
  const described = error ? ' aria-describedby="respondent_name_error" aria-invalid="true"' : '';
  return `<div class="field respondent-name${error ? ' has-error' : ''}">
    <label for="respondent_name">${esc(t('respond.yourName'))} <span class="muted">${esc(t('respond.optional'))}</span></label>
    <span class="hint">${esc(t('respond.anonymousHint'))}</span>
    <input id="respondent_name" name="respondent_name" value="${esc(value)}" maxlength="${LIMITS.respondentName}" autocomplete="name"${described}>
    ${errorHtml}
  </div>`;
}

export function publicFormPage({ survey, values = {}, errors = {}, respondentName = '', respondentNameError, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  const invalid = survey.fields.filter((f) => errors[f.id]);
  const problems = [
    ...(respondentNameError ? [`<a href="#respondent_name">${esc(t('respond.yourName'))}</a>: ${esc(respondentNameError)}`] : []),
    ...invalid.map((f) => `<a href="#fld_${esc(f.id)}">${esc(f.label)}</a>: ${esc(errors[f.id])}`),
  ];
  const errorSummary = problems.length
    ? errorList([esc(i18n.tn('respond.checkAnswers', problems.length)), ...problems])
    : '';
  const hasRequired = survey.fields.some((f) => f.required);
  return layout({
    title: survey.title,
    respondent: true,
    i18n,
    currentPath,
    body: `<div class="panel intro">
  <h1>${esc(survey.title)}</h1>
  ${survey.description ? `<p class="description">${esc(survey.description)}</p>` : ''}
  <p class="meta">${icon('calendar')} ${esc(t('respond.openUntil', { date: i18n.formatDate(survey.closesOn) }))}</p>
  ${hasRequired ? `<p class="hint">${tHtml(i18n, 'respond.requiredHint', { mark: '<span class="req">*</span>' })}</p>` : ''}
</div>
${errorSummary}
<form method="post" action="/s/${esc(survey.publicToken)}" class="stack respondent-form" data-limits="${esc(JSON.stringify(LIMITS))}">
  ${respondentNameField(respondentName, respondentNameError, i18n)}
  ${survey.fields.map((f, i) => renderField(f, values[f.id] ?? '', errors[f.id], i, i18n)).join('\n')}
  <button type="submit" class="big block">${icon('check')} ${esc(t('respond.submit'))}</button>
</form>`,
  });
}

export function thanksPage({ survey, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  return layout({
    title: t('respond.thanksTitle'),
    respondent: true,
    i18n,
    currentPath,
    body: `<div class="panel result">
  <div class="result-icon ok">${icon('check')}</div>
  <h1>${esc(t('respond.thanksHeading'))}</h1>
  <p>${tHtml(i18n, 'respond.thanksSent', { title: `<strong>${esc(survey.title)}</strong>` })}</p>
  <p class="muted">${esc(t('respond.thanksClose'))}</p>
</div>`,
  });
}

export function alreadyAnsweredPage({ survey, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  return layout({
    title: survey.title,
    respondent: true,
    i18n,
    currentPath,
    body: `<div class="panel result">
  <div class="result-icon ok">${icon('check')}</div>
  <h1>${esc(survey.title)}</h1>
  <p>${esc(t('respond.alreadyAnswered'))}</p>
  <p class="muted">${esc(t('respond.onePerDevice'))}</p>
</div>`,
  });
}

export function closedPage({ survey, status = 'closed', i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  return layout({
    title: survey.title,
    respondent: true,
    i18n,
    currentPath,
    body: `<div class="panel result">
  <div class="result-icon">${icon(status === 'expired' ? 'calendar' : 'lock')}</div>
  <h1>${esc(survey.title)}</h1>
  <p>${esc(status === 'expired'
    ? t('respond.closedOn', { date: i18n.formatDate(survey.closesOn) })
    : t('respond.closed'))}</p>
</div>`,
  });
}

export function errorPage({ status, message, user, csrf, respondent, i18n = defaultI18n, currentPath }) {
  const { t } = i18n;
  return layout({
    title: t('error.title', { status }),
    user,
    csrf,
    respondent,
    i18n,
    currentPath,
    body: `<div class="panel result">
  <div class="result-icon">${icon('alert')}</div>
  <h1>${esc(t('error.heading'))}</h1>
  <p>${esc(message)}</p>
  ${respondent ? '' : `<p><a class="button" href="/">${esc(t('error.home'))}</a></p>`}
</div>`,
  });
}
