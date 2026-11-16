import { FIELD_TYPES, LIMITS, formatAnswer, summarize, surveyStatus } from './surveys.js';

export const APP_NAME = 'Sharevy';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

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
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};

export const icon = (name, extraClass = '') =>
  `<svg class="icon${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// Rendered hidden: public/app.js shows it and keeps its label in sync with the active theme.
const themeToggle = () =>
  `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch to dark theme" title="Switch to dark theme" hidden>${icon('moon', 'icon-moon')}${icon('sun', 'icon-sun')}</button>`;

// Confirmation messages shown after an action (?msg=<key>). Only known keys are rendered.
const FLASH_MESSAGES = {
  created: 'Survey created. Copy the link below and send it to the people who should answer.',
  saved: 'Changes saved.',
  closed: 'Survey closed. It no longer accepts answers.',
  opened: 'Survey reopened. It accepts answers again.',
  'response-deleted': 'Response deleted.',
  deleted: 'Survey deleted.',
};
export const flashMessage = (key) => (Object.hasOwn(FLASH_MESSAGES, key) ? FLASH_MESSAGES[key] : undefined);

function layout({ title, body, user, csrf, flash, respondent = false }) {
  const pageTitle = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
  let nav = '';
  if (!respondent) {
    nav = user
      ? `<nav aria-label="Main">
          <a href="/surveys">My surveys</a>
          <span class="who">${esc(user.name)}</span>
          <form method="post" action="/logout" class="inline">${csrfInput(csrf)}<button type="submit" class="link">${icon('logout')} Log out</button></form>
        </nav>`
      : `<nav aria-label="Main"><a href="/login">Log in</a></nav>`;
  }
  const brand = respondent
    ? `<span class="brand">${APP_NAME}</span>`
    : `<a href="/" class="brand">${APP_NAME}</a>`;
  const flashHtml = flash ? `<div class="flash" role="status">${icon('check')}<span>${esc(flash)}</span></div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#5b3cc4">
<title>${esc(pageTitle)}</title>
<link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${asset('style.css')}">
<script src="${asset('theme.js')}"></script>
</head>
<body${respondent ? ' class="respondent"' : ''}>
<header class="topbar"><div class="topbar-inner">${brand}<div class="topbar-actions">${nav}${themeToggle()}</div></div></header>
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
  open: '<span class="badge open">Open</span>',
  closed: '<span class="badge closed">Closed</span>',
  expired: '<span class="badge closed">Expired</span>',
};
const statusBadge = (status) => STATUS_BADGES[status];

/** "2026-11-26" -> "Nov 26, 2026". */
export function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function closingText(survey, status) {
  if (status === 'expired') return `Closed on ${formatDate(survey.closesOn)} (closing date passed)`;
  return `Closes on ${formatDate(survey.closesOn)}`;
}

export function homePage({ allowRegistration }) {
  return layout({
    title: APP_NAME,
    body: `<section class="hero">
  <h1>${APP_NAME}</h1>
  <p class="lead">Create a survey, share a link, and see the answers. People who answer do not need an account.</p>
  <ol class="steps">
    <li><strong>Create</strong> your questions.</li>
    <li><strong>Share</strong> the link by email or chat.</li>
    <li><strong>See</strong> the answers and download them.</li>
  </ol>
  <div class="button-row">
    <a class="button big" href="/login">Log in</a>
    ${allowRegistration ? '<a class="button big secondary" href="/register">Create an account</a>' : ''}
  </div>
</section>`,
  });
}

export function loginPage({ next, email = '', error, allowRegistration }) {
  return layout({
    title: 'Log in',
    body: `<div class="panel narrow">
<h1>Log in</h1>
<p class="muted">Only needed to create surveys.</p>
${escapedErrors(error ? [error] : [])}
<form method="post" action="/login" class="stack">
  <input type="hidden" name="next" value="${esc(next)}">
  <label>Email <input type="email" name="email" value="${esc(email)}" required autofocus autocomplete="username" inputmode="email"></label>
  <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
  <button type="submit" class="big">Log in</button>
</form>
${allowRegistration ? '<p>No account yet? <a href="/register">Create one</a>.</p>' : ''}
</div>`,
  });
}

export function registerPage({ values = {}, errors = [] }) {
  return layout({
    title: 'Create an account',
    body: `<div class="panel narrow">
<h1>Create an account</h1>
<p class="muted">You only need an account to create surveys. People who answer never need one.</p>
${escapedErrors(errors)}
<form method="post" action="/register" class="stack">
  <label>Your name <input name="name" value="${esc(values.name)}" required maxlength="100" autocomplete="name"></label>
  <label>Email <input type="email" name="email" value="${esc(values.email)}" required maxlength="254" autocomplete="username" inputmode="email"></label>
  <label>Password <span class="hint">At least 8 characters.</span>
    <input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>
  <label>Repeat the password <input type="password" name="confirm" required minlength="8" maxlength="200" autocomplete="new-password"></label>
  <button type="submit" class="big">Create account</button>
</form>
<p>Already have an account? <a href="/login">Log in</a>.</p>
</div>`,
  });
}

export function surveyListPage({ user, csrf, surveys, flash, today }) {
  const cards = surveys.map((s) => { const status = surveyStatus(s, today); return `<li>
    <a class="card card-link" href="/surveys/${s.id}">
      <span class="card-title">${esc(s.title)}</span>
      ${statusBadge(status)}
      <span class="muted">${s.responseCount} ${s.responseCount === 1 ? 'response' : 'responses'} · ${esc(closingText(s, status))}</span>
    </a>
  </li>`; }).join('');
  return layout({
    title: 'My surveys',
    user,
    csrf,
    flash,
    body: `<div class="page-head">
  <h1>My surveys</h1>
  <a class="button" href="/surveys/new">${icon('plus')} New survey</a>
</div>
${surveys.length
    ? `<ul class="cards">${cards}</ul>`
    : `<div class="empty">${icon('inbox')}<p>You have no surveys yet.</p><a class="button big" href="/surveys/new">${icon('plus')} Create your first survey</a></div>`}`,
  });
}

export function surveyEditorPage({ user, csrf, survey, values, errors = [], today }) {
  // An expired survey keeps its past date valid until the creator changes it.
  const minDate = survey?.closesOn && survey.closesOn < today ? survey.closesOn : today;
  const editing = Boolean(survey);
  const action = editing ? `/surveys/${survey.id}` : '/surveys';
  const cancel = editing ? `/surveys/${survey.id}` : '/surveys';
  const warning = editing && survey.responseCount > 0
    ? `<p class="notice">${icon('alert')}<span>This survey already has ${survey.responseCount} answer(s). They are kept, but answers to questions you remove will no longer be shown.</span></p>`
    : '';
  return layout({
    title: editing ? `Edit: ${survey.title}` : 'New survey',
    user,
    csrf,
    body: `<a class="back" href="${cancel}">${icon('back')} Back</a>
<h1>${editing ? 'Edit survey' : 'New survey'}</h1>
${warning}
${escapedErrors(errors)}
<form method="post" action="${action}" class="stack" id="survey-form">
  ${csrfInput(csrf)}
  <section class="panel stack">
    <h2>1. Basic information</h2>
    <label>Survey title <input name="title" value="${esc(values.title)}" required maxlength="${LIMITS.title}" placeholder="e.g. Team lunch preferences"></label>
    <label>Description <span class="hint">Optional. Shown at the top of the survey.</span>
      <textarea name="description" rows="3" maxlength="${LIMITS.description}">${esc(values.description)}</textarea></label>
    <label>Closing date <span class="hint">The survey accepts answers until the end of this day. By default, 10 days from today.</span>
      <input type="date" name="closes_on" value="${esc(values.closesOn)}" min="${esc(minDate)}" required></label>
  </section>
  <section class="stack">
    <h2>2. Questions</h2>
    <input type="hidden" name="fields_json" id="fields_json" value="${esc(values.fieldsJson)}">
    <div id="builder" data-types="${esc(JSON.stringify(FIELD_TYPES))}"></div>
    <noscript><p class="errors">JavaScript must be enabled to edit questions.</p></noscript>
  </section>
  <div class="form-footer">
    <button type="submit" class="big">${icon('check')} ${editing ? 'Save changes' : 'Create survey'}</button>
    <a class="button big secondary" href="${cancel}">Cancel</a>
  </div>
</form>
<script src="${asset('builder.js')}"></script>`,
  });
}

function summaryHtml(fields, responses) {
  const items = summarize(fields, responses);
  if (!items.length || !responses.length) return '';
  return `<h3>Summary</h3>${items.map(({ field, answered, counts }) => `
<section class="panel summary">
  <h4>${esc(field.label)} <span class="muted">(${answered} answered)</span></h4>
  <ul class="bars">${counts.map(({ option, count }) => {
    const pct = answered ? Math.round((count / answered) * 100) : 0;
    return `<li><span class="bar-label">${esc(option)}</span><meter min="0" max="100" value="${pct}"></meter><span class="bar-value">${count} (${pct}%)</span></li>`;
  }).join('')}</ul>
</section>`).join('')}`;
}

export function surveyDetailPage({ user, csrf, survey, responses, shareUrl, flash, today }) {
  const status = surveyStatus(survey, today);
  const head = survey.fields.map((f) => `<th>${esc(f.label)}</th>`).join('');
  const rows = responses.map((r) => `<tr>
    <td data-label="Response">#${r.id}</td>
    <td data-label="Sent (UTC)" class="nowrap">${esc(r.submittedAt)}</td>
    <td data-label="Name">${r.respondentName ? esc(r.respondentName) : '<span class="muted">Anonymous</span>'}</td>
    ${survey.fields.map((f) => `<td data-label="${esc(f.label)}">${esc(formatAnswer(r.answers[f.id])) || '<span class="muted">-</span>'}</td>`).join('')}
    <td class="row-actions"><form method="post" action="/surveys/${survey.id}/responses/${r.id}/delete" data-confirm="Delete response #${r.id}? This cannot be undone.">${csrfInput(csrf)}
      <button type="submit" class="icon-button danger" aria-label="Delete response #${r.id}" title="Delete response">${icon('trash')}</button></form></td>
  </tr>`).join('');

  return layout({
    title: survey.title,
    user,
    csrf,
    flash,
    body: `<a class="back" href="/surveys">${icon('back')} My surveys</a>
<h1>${esc(survey.title)} ${statusBadge(status)}</h1>
<p class="meta">${icon('calendar')} ${esc(closingText(survey, status))}</p>
${survey.description ? `<p class="description">${esc(survey.description)}</p>` : ''}

<section class="panel share">
  <h2>${icon('share')} Share this link</h2>
  <p>Send this link to the people who should answer. They do not need an account.</p>
  ${status === 'closed' ? `<p class="notice">${icon('lock')}<span>The survey is closed: people who open the link will see that it no longer accepts answers.</span></p>` : ''}
  ${status === 'expired' ? `<p class="notice">${icon('calendar')}<span>The closing date has passed, so the survey no longer accepts answers. <a href="/surveys/${survey.id}/edit">Change the closing date</a> to open it again.</span></p>` : ''}
  <input id="share-url" class="share-url" value="${esc(shareUrl)}" readonly aria-label="Share link">
  <div class="button-row">
    <button type="button" data-copy="share-url">${icon('copy')} <span>Copy link</span></button>
    <button type="button" class="secondary" data-share="share-url" data-share-title="${esc(survey.title)}" hidden>${icon('share')} Share</button>
    <a class="button secondary" href="${esc(shareUrl)}" target="_blank" rel="noopener">${icon('open')} Open form</a>
  </div>
</section>

<section class="panel">
  <h2>Manage</h2>
  <div class="button-row">
    <a class="button secondary" href="/surveys/${survey.id}/edit">${icon('edit')} Edit survey</a>
    <form method="post" action="/surveys/${survey.id}/toggle" class="inline">${csrfInput(csrf)}
      ${survey.isOpen
    ? `<button type="submit" class="secondary">${icon('lock')} Close survey</button>`
    : `<button type="submit" class="secondary">${icon('unlock')} Reopen survey</button>`}
    </form>
    <form method="post" action="/surveys/${survey.id}/delete" class="inline" data-confirm="Delete this survey and ALL its answers? This cannot be undone.">${csrfInput(csrf)}
      <button type="submit" class="danger">${icon('trash')} Delete survey</button>
    </form>
  </div>
  <p class="hint">Closing a survey stops new answers before its closing date. You can reopen it at any time.</p>
</section>

<section>
  <div class="page-head">
    <h2>Responses (${responses.length})</h2>
    <div class="button-row">
      <a class="button secondary" href="/surveys/${survey.id}/export.csv?delimiter=semicolon">${icon('download')} Excel (CSV)</a>
      <a class="button secondary" href="/surveys/${survey.id}/export.csv">${icon('download')} CSV</a>
    </div>
  </div>
  ${summaryHtml(survey.fields, responses)}
  ${responses.length
    ? `<h3>All answers</h3><div class="table-wrap"><table class="responsive"><thead><tr><th>#</th><th>Sent (UTC)</th><th>Name</th>${head}<th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty">${icon('inbox')}<p>No answers yet. Share the link above to start collecting them.</p></div>`}
</section>`,
  });
}

const INPUT_TYPES = { text: 'text', number: 'number', email: 'email', date: 'date' };
const INPUT_MODES = { number: 'decimal', email: 'email' };

function renderField(field, value, error, index) {
  const name = `f_${field.id}`;
  const id = `fld_${field.id}`;
  const required = field.required ? ' required' : '';
  const mark = field.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const errorHtml = error ? `<p class="field-error" id="${id}_error">${icon('alert')} ${esc(error)}</p>` : '';
  const described = error ? ` aria-describedby="${id}_error" aria-invalid="true"` : '';
  const number = `<span class="q-number">${index + 1}.</span> `;
  const wrap = (inner) => `<div class="field${error ? ' has-error' : ''}">${inner}${errorHtml}</div>`;

  switch (field.type) {
    case 'radio':
    case 'checkbox': {
      const selected = Array.isArray(value) ? value : [value];
      const hint = field.type === 'checkbox' ? '<span class="hint">You can choose more than one.</span>' : '';
      const inputs = field.options.map((option, i) => `<label class="choice">
        <input type="${field.type}" name="${name}" value="${esc(option)}"${selected.includes(option) ? ' checked' : ''}${field.type === 'radio' && i === 0 ? required : ''}>
        <span>${esc(option)}</span></label>`).join('');
      return wrap(`<fieldset id="${id}"${described}><legend>${number}${esc(field.label)}${mark}</legend>${hint}<div class="choices">${inputs}</div></fieldset>`);
    }
    case 'select': {
      const options = field.options.map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('');
      return wrap(`<label for="${id}">${number}${esc(field.label)}${mark}</label>
        <select id="${id}" name="${name}"${required}${described}><option value="">Choose an option…</option>${options}</select>`);
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

function respondentNameField(value, error) {
  const errorHtml = error ? `<p class="field-error" id="respondent_name_error">${icon('alert')} ${esc(error)}</p>` : '';
  const described = error ? ' aria-describedby="respondent_name_error" aria-invalid="true"' : '';
  return `<div class="field respondent-name${error ? ' has-error' : ''}">
    <label for="respondent_name">Your name <span class="muted">(optional)</span></label>
    <span class="hint">Leave it empty to answer anonymously.</span>
    <input id="respondent_name" name="respondent_name" value="${esc(value)}" maxlength="${LIMITS.respondentName}" autocomplete="name"${described}>
    ${errorHtml}
  </div>`;
}

export function publicFormPage({ survey, values = {}, errors = {}, respondentName = '', respondentNameError }) {
  const invalid = survey.fields.filter((f) => errors[f.id]);
  const problems = [
    ...(respondentNameError ? [`<a href="#respondent_name">Your name</a>: ${esc(respondentNameError)}`] : []),
    ...invalid.map((f) => `<a href="#fld_${esc(f.id)}">${esc(f.label)}</a>: ${esc(errors[f.id])}`),
  ];
  const errorSummary = problems.length
    ? errorList([`Please check ${problems.length === 1 ? 'this answer' : `these ${problems.length} answers`}:`, ...problems])
    : '';
  const hasRequired = survey.fields.some((f) => f.required);
  return layout({
    title: survey.title,
    respondent: true,
    body: `<div class="panel intro">
  <h1>${esc(survey.title)}</h1>
  ${survey.description ? `<p class="description">${esc(survey.description)}</p>` : ''}
  <p class="meta">${icon('calendar')} Open until ${esc(formatDate(survey.closesOn))}</p>
  ${hasRequired ? '<p class="hint">Questions marked with <span class="req">*</span> must be answered.</p>' : ''}
</div>
${errorSummary}
<form method="post" action="/s/${esc(survey.publicToken)}" class="stack respondent-form">
  ${respondentNameField(respondentName, respondentNameError)}
  ${survey.fields.map((f, i) => renderField(f, values[f.id] ?? '', errors[f.id], i)).join('\n')}
  <button type="submit" class="big block">${icon('check')} Send my answers</button>
</form>`,
  });
}

export function thanksPage({ survey }) {
  return layout({
    title: 'Thank you',
    respondent: true,
    body: `<div class="panel result">
  <div class="result-icon ok">${icon('check')}</div>
  <h1>Thank you!</h1>
  <p>Your answers to <strong>${esc(survey.title)}</strong> were sent.</p>
  <p class="muted">You can close this page now.</p>
  <p><a href="/s/${esc(survey.publicToken)}">Send another response</a></p>
</div>`,
  });
}

export function closedPage({ survey, status = 'closed' }) {
  return layout({
    title: survey.title,
    respondent: true,
    body: `<div class="panel result">
  <div class="result-icon">${icon(status === 'expired' ? 'calendar' : 'lock')}</div>
  <h1>${esc(survey.title)}</h1>
  <p>${status === 'expired'
    ? `This survey closed on ${esc(formatDate(survey.closesOn))} and no longer accepts answers.`
    : 'This survey is closed and no longer accepts answers.'}</p>
</div>`,
  });
}

export function errorPage({ status, message, user, csrf, respondent }) {
  return layout({
    title: `Error ${status}`,
    user,
    csrf,
    respondent,
    body: `<div class="panel result">
  <div class="result-icon">${icon('alert')}</div>
  <h1>Something is not right</h1>
  <p>${esc(message)}</p>
  ${respondent ? '' : '<p><a class="button" href="/">Go to the start page</a></p>'}
</div>`,
  });
}
