import { FIELD_TYPES, LIMITS, formatAnswer, summarize } from './surveys.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

const csrfInput = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

function layout({ title, body, user, csrf, respondent = false }) {
  let nav = '';
  if (!respondent) {
    nav = user
      ? `<nav>
          <a href="/surveys">My surveys</a>
          <a href="/surveys/new">New survey</a>
          <form method="post" action="/logout" class="inline">${csrfInput(csrf)}<button type="submit" class="link">Log out (${esc(user.name)})</button></form>
        </nav>`
      : `<nav><a href="/login">Log in</a></nav>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/public/style.css">
</head>
<body>
<header>${respondent ? '<span class="brand">Survey</span>' : '<a href="/" class="brand">Surveys</a>'}${nav}</header>
<main>
${body}
</main>
<script src="/public/app.js"></script>
</body>
</html>`;
}

function errorList(errors) {
  if (!errors?.length) return '';
  return `<div class="errors" role="alert"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
}

export function homePage({ allowRegistration }) {
  return layout({
    title: 'Surveys',
    body: `<h1>Surveys</h1>
<p>Create surveys and share them with a link. Respondents do not need an account.</p>
<p><a class="button" href="/login">Log in</a>${allowRegistration ? ' <a class="button secondary" href="/register">Create a creator account</a>' : ''}</p>`,
  });
}

export function loginPage({ next, email = '', error, allowRegistration }) {
  return layout({
    title: 'Log in',
    body: `<h1>Log in</h1>
${errorList(error ? [error] : [])}
<form method="post" action="/login" class="stack narrow">
  <input type="hidden" name="next" value="${esc(next)}">
  <label>Email <input type="email" name="email" value="${esc(email)}" required autofocus autocomplete="username"></label>
  <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
  <button type="submit">Log in</button>
</form>
${allowRegistration ? '<p>No account? <a href="/register">Register as a survey creator</a>.</p>' : ''}`,
  });
}

export function registerPage({ values = {}, errors = [] }) {
  return layout({
    title: 'Register',
    body: `<h1>Create a creator account</h1>
<p>Accounts are only needed to create surveys. Respondents never need one.</p>
${errorList(errors)}
<form method="post" action="/register" class="stack narrow">
  <label>Name <input name="name" value="${esc(values.name)}" required maxlength="100" autocomplete="name"></label>
  <label>Email <input type="email" name="email" value="${esc(values.email)}" required maxlength="254" autocomplete="username"></label>
  <label>Password (min. 8 characters) <input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password"></label>
  <label>Confirm password <input type="password" name="confirm" required minlength="8" maxlength="200" autocomplete="new-password"></label>
  <button type="submit">Create account</button>
</form>
<p>Already registered? <a href="/login">Log in</a>.</p>`,
  });
}

export function surveyListPage({ user, csrf, surveys }) {
  const rows = surveys.map((s) => `<tr>
    <td><a href="/surveys/${s.id}">${esc(s.title)}</a></td>
    <td>${s.isOpen ? '<span class="badge open">Open</span>' : '<span class="badge closed">Closed</span>'}</td>
    <td class="num">${s.responseCount}</td>
    <td>${esc(s.createdAt)} UTC</td>
  </tr>`).join('');
  return layout({
    title: 'My surveys',
    user,
    csrf,
    body: `<h1>My surveys</h1>
<p><a class="button" href="/surveys/new">+ New survey</a></p>
${surveys.length
    ? `<table><thead><tr><th>Title</th><th>Status</th><th class="num">Responses</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p>You have no surveys yet.</p>'}`,
  });
}

export function surveyEditorPage({ user, csrf, survey, values, errors = [] }) {
  const editing = Boolean(survey);
  const action = editing ? `/surveys/${survey.id}` : '/surveys';
  const warning = editing && survey.responseCount > 0
    ? `<p class="notice">This survey already has ${survey.responseCount} response(s). Existing answers are kept; answers to removed questions will no longer be shown.</p>`
    : '';
  return layout({
    title: editing ? `Edit: ${survey.title}` : 'New survey',
    user,
    csrf,
    body: `<h1>${editing ? 'Edit survey' : 'New survey'}</h1>
${warning}
${errorList(errors)}
<form method="post" action="${action}" class="stack" id="survey-form">
  ${csrfInput(csrf)}
  <label>Title <input name="title" value="${esc(values.title)}" required maxlength="${LIMITS.title}"></label>
  <label>Description (optional) <textarea name="description" rows="3" maxlength="${LIMITS.description}">${esc(values.description)}</textarea></label>
  <input type="hidden" name="fields_json" id="fields_json" value="${esc(values.fieldsJson)}">
  <h2>Questions</h2>
  <div id="builder" data-types="${esc(JSON.stringify(FIELD_TYPES))}"></div>
  <noscript><p class="errors">JavaScript is required to edit questions.</p></noscript>
  <p><button type="submit">${editing ? 'Save changes' : 'Create survey'}</button>
  <a href="${editing ? `/surveys/${survey.id}` : '/surveys'}">Cancel</a></p>
</form>
<script src="/public/builder.js"></script>`,
  });
}

function summaryHtml(fields, responses) {
  const items = summarize(fields, responses);
  if (!items.length) return '';
  return `<h2>Summary</h2>${items.map(({ field, answered, counts }) => `
<section class="summary">
  <h3>${esc(field.label)} <small>(${answered} answered)</small></h3>
  <table><tbody>${counts.map(({ option, count }) => {
    const pct = answered ? Math.round((count / answered) * 100) : 0;
    return `<tr><td>${esc(option)}</td><td class="num">${count}</td><td class="num">${pct}%</td><td><meter min="0" max="100" value="${pct}"></meter></td></tr>`;
  }).join('')}</tbody></table>
</section>`).join('')}`;
}

export function surveyDetailPage({ user, csrf, survey, responses, shareUrl }) {
  const head = survey.fields.map((f) => `<th>${esc(f.label)}</th>`).join('');
  const rows = responses.map((r) => `<tr>
    <td class="num">${r.id}</td>
    <td class="nowrap">${esc(r.submittedAt)}</td>
    ${survey.fields.map((f) => `<td>${esc(formatAnswer(r.answers[f.id]))}</td>`).join('')}
    <td><form method="post" action="/surveys/${survey.id}/responses/${r.id}/delete" data-confirm="Delete response #${r.id}?">${csrfInput(csrf)}<button type="submit" class="link danger">Delete</button></form></td>
  </tr>`).join('');

  return layout({
    title: survey.title,
    user,
    csrf,
    body: `<h1>${esc(survey.title)} ${survey.isOpen ? '<span class="badge open">Open</span>' : '<span class="badge closed">Closed</span>'}</h1>
${survey.description ? `<p class="description">${esc(survey.description)}</p>` : ''}

<section class="share">
  <h2>Share link</h2>
  <p>Anyone with this link can answer, no account needed.</p>
  <div class="row">
    <input id="share-url" value="${esc(shareUrl)}" readonly>
    <button type="button" data-copy="share-url">Copy link</button>
    <a class="button secondary" href="${esc(shareUrl)}" target="_blank" rel="noopener">Open form</a>
  </div>
</section>

<div class="row actions">
  <a class="button secondary" href="/surveys/${survey.id}/edit">Edit questions</a>
  <form method="post" action="/surveys/${survey.id}/toggle" class="inline">${csrfInput(csrf)}
    <button type="submit" class="secondary">${survey.isOpen ? 'Close survey (stop accepting responses)' : 'Reopen survey'}</button>
  </form>
  <form method="post" action="/surveys/${survey.id}/delete" class="inline" data-confirm="Delete this survey and ALL its responses? This cannot be undone.">${csrfInput(csrf)}
    <button type="submit" class="danger">Delete survey</button>
  </form>
</div>

<h2>Responses (${responses.length})</h2>
<p>
  <a class="button secondary" href="/surveys/${survey.id}/export.csv">Download CSV</a>
  <a class="button secondary" href="/surveys/${survey.id}/export.csv?delimiter=semicolon">Download CSV (; for Excel)</a>
</p>
${summaryHtml(survey.fields, responses)}
${responses.length
    ? `<div class="scroll"><table><thead><tr><th>#</th><th>Submitted (UTC)</th>${head}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p>No responses yet.</p>'}`,
  });
}

const INPUT_TYPES = { text: 'text', number: 'number', email: 'email', date: 'date' };

function renderField(field, value, error) {
  const name = `f_${field.id}`;
  const id = `fld_${field.id}`;
  const required = field.required ? ' required' : '';
  const mark = field.required ? ' <span class="req" title="Required">*</span>' : '';
  const errorHtml = error ? `<p class="field-error">${esc(error)}</p>` : '';
  const wrap = (inner) => `<div class="field${error ? ' has-error' : ''}">${inner}${errorHtml}</div>`;

  switch (field.type) {
    case 'radio':
    case 'checkbox': {
      const selected = Array.isArray(value) ? value : [value];
      const inputs = field.options.map((option, i) => `<label class="choice">
        <input type="${field.type}" name="${name}" value="${esc(option)}"${selected.includes(option) ? ' checked' : ''}${field.type === 'radio' && i === 0 ? required : ''}>
        ${esc(option)}</label>`).join('');
      return wrap(`<fieldset><legend>${esc(field.label)}${mark}</legend>${inputs}</fieldset>`);
    }
    case 'select': {
      const options = field.options.map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('');
      return wrap(`<label for="${id}">${esc(field.label)}${mark}</label>
        <select id="${id}" name="${name}"${required}><option value="">-- Select --</option>${options}</select>`);
    }
    case 'textarea':
      return wrap(`<label for="${id}">${esc(field.label)}${mark}</label>
        <textarea id="${id}" name="${name}" rows="4" maxlength="${LIMITS.textarea}"${required}>${esc(value)}</textarea>`);
    default: {
      const extra = field.type === 'number' ? ' step="any"' : field.type === 'text' ? ` maxlength="${LIMITS.text}"` : '';
      return wrap(`<label for="${id}">${esc(field.label)}${mark}</label>
        <input id="${id}" type="${INPUT_TYPES[field.type] ?? 'text'}" name="${name}" value="${esc(value)}"${extra}${required}>`);
    }
  }
}

export function publicFormPage({ survey, values = {}, errors = {} }) {
  const hasErrors = Object.keys(errors).length > 0;
  return layout({
    title: survey.title,
    respondent: true,
    body: `<h1>${esc(survey.title)}</h1>
${survey.description ? `<p class="description">${esc(survey.description)}</p>` : ''}
${hasErrors ? errorList(['Please fix the highlighted fields.']) : ''}
<form method="post" action="/s/${esc(survey.publicToken)}" class="stack">
  ${survey.fields.map((f) => renderField(f, values[f.id] ?? '', errors[f.id])).join('\n')}
  <p class="hint"><span class="req">*</span> Required</p>
  <button type="submit">Submit</button>
</form>`,
  });
}

export function thanksPage({ survey }) {
  return layout({
    title: 'Thank you',
    respondent: true,
    body: `<h1>Thank you!</h1>
<p>Your response to <strong>${esc(survey.title)}</strong> has been recorded.</p>
<p><a href="/s/${esc(survey.publicToken)}">Submit another response</a></p>`,
  });
}

export function closedPage({ survey }) {
  return layout({
    title: survey.title,
    respondent: true,
    body: `<h1>${esc(survey.title)}</h1><p class="notice">This survey is closed and no longer accepts responses.</p>`,
  });
}

export function errorPage({ status, message, user, csrf, respondent }) {
  return layout({
    title: `Error ${status}`,
    user,
    csrf,
    respondent,
    body: `<h1>Error ${status}</h1><p>${esc(message)}</p>${respondent ? '' : '<p><a href="/">Go home</a></p>'}`,
  });
}
