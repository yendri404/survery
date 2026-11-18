import { ApiError } from '../api.js';
import { adminHref, adminSurveyCards, adminUserCards } from '../components/admin.js';
import { icon } from '../components/icons.js';
import { emptyState, errorList } from '../components/layout.js';
import { h, setErrorBox } from '../dom.js';
import { editorPage } from './editor.js';

/** `href` with a confirmation message (?msg=<key>, shown by the app shell). */
const withMsg = (href, msg) => `${href}${href.includes('?') ? '&' : '?'}msg=${msg}`;

/** API problems as messages: one per field when the API names fields, else the error itself. */
function problems(app, err) {
  if (err instanceof ApiError && err.fields) return Object.values(err.fields).map((p) => app.error(new ApiError(422, p)));
  return [app.error(err)];
}

/** A small form with a submit button that cannot send twice; `action()` errors show above it. */
function passwordForm(app, { inputs, submitText, action }) {
  const submit = h('button', { type: 'submit', class: 'big' }, submitText);
  const form = h('form', { class: 'stack' }, ...inputs, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await action();
    } catch (err) {
      setErrorBox(form, errorList(problems(app, err)));
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

/** First visit of an instance: creates the master password (the API accepts only the first one). */
function setupView(app) {
  const { t } = app;
  const password = h('input', { type: 'password', name: 'password', required: true, minlength: 12, maxlength: 200, autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', name: 'confirm', required: true, minlength: 12, maxlength: 200, autocomplete: 'new-password' });
  const form = passwordForm(app, {
    inputs: [
      h('label', {}, `${t('admin.password')} `, h('span', { class: 'hint' }, t('admin.passwordHint')), password),
      h('label', {}, `${t('admin.confirm')} `, confirm),
    ],
    submitText: t('admin.create'),
    action: async () => {
      const { token } = await app.adminApi.post('/admin/setup', { password: password.value, confirm: confirm.value });
      app.setAdminToken(token);
      await app.navigate('/..command/', { replace: true });
    },
  });
  return {
    title: t('admin.setupTitle'),
    body: [h('div', { class: 'panel narrow' },
      h('h1', {}, t('admin.setupTitle')),
      h('p', { class: 'notice' }, icon('alert'), h('span', {}, t('admin.setupIntro'))),
      form)],
    mounted: () => password.focus(),
  };
}

function loginView(app) {
  const { t } = app;
  const password = h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' });
  const form = passwordForm(app, {
    inputs: [h('label', {}, `${t('admin.password')} `, password)],
    submitText: t('admin.login'),
    action: async () => {
      try {
        const { token } = await app.adminApi.post('/admin/login', { password: password.value });
        app.setAdminToken(token);
        await app.navigate(location.pathname + location.search, { replace: true });
      } finally {
        password.value = '';
      }
    },
  });
  return {
    title: t('admin.title'),
    body: [h('div', { class: 'panel narrow' }, h('h1', {}, t('admin.title')), h('p', { class: 'muted' }, t('admin.loginIntro')), form)],
    mounted: () => password.focus(),
  };
}

/**
 * Container: the admin panel (/..command/). Creates the master password on an instance without one,
 * asks for it without a token, else shows two columns: every user as a card, and the surveys of the
 * user picked (?user=<id>) with their controls. Actions reload the page with a confirmation.
 */
export async function adminPage(app, { query, signal }) {
  const { t } = app;
  const { configured } = await app.adminApi.get('/admin/status', { signal });
  if (!configured) {
    app.setAdminToken(null); // a token from before a reset in the database is dead anyway
    return setupView(app);
  }
  if (!app.adminToken) return loginView(app);

  const selectedId = Number(query.get('user')) || null;
  const [{ users }, surveys] = await Promise.all([
    app.adminApi.get('/admin/users', { signal }),
    selectedId
      ? app.adminApi.get(`/admin/users/${selectedId}/surveys`, { signal }).then((r) => r.surveys).catch((err) => {
        if (err instanceof ApiError && err.status === 404) return null; // the user was deleted meanwhile
        throw err;
      })
      : null,
  ]);
  const selected = surveys ? users.find((user) => user.id === selectedId) : undefined;
  const here = adminHref(selected?.id);

  /** Runs an API action, then reloads the panel at `to` (failures replace the page with the error). */
  const act = (action, to) => async () => {
    try {
      await action();
      await app.navigate(to, { replace: true });
    } catch (err) {
      app.showError(err);
    }
  };
  const onDeleteUser = (user) => {
    if (!window.confirm(t('admin.deleteUserConfirm', { name: user.name, email: user.email }))) return;
    act(() => app.adminApi.del(`/admin/users/${user.id}`), withMsg(adminHref(user.id === selected?.id ? null : selected?.id), 'user-deleted'))();
  };
  const onSetPassword = (user, password) => act(() => app.adminApi.put(`/admin/users/${user.id}/password`, { password }), withMsg(here, 'password-set'))();
  const onToggle = (survey) => act(() => app.adminApi.patch(`/admin/surveys/${survey.id}`, { isOpen: !survey.isOpen }), withMsg(here, survey.isOpen ? 'closed' : 'opened'))();
  const onDeleteSurvey = (survey) => {
    if (!window.confirm(t('list.deleteConfirm', { title: survey.title }))) return;
    act(() => app.adminApi.del(`/admin/surveys/${survey.id}`), withMsg(here, 'deleted'))();
  };
  const logout = async () => {
    await app.adminApi.post('/admin/logout').catch(() => {});
    app.setAdminToken(null);
    await app.navigate('/..command/', { replace: true });
  };

  return {
    title: t('admin.title'),
    body: [
      h('div', { class: 'page-head' },
        h('h1', {}, t('admin.title')),
        h('button', { type: 'button', class: 'secondary', onclick: logout }, icon('logout'), ` ${t('admin.logout')}`)),
      h('div', { class: 'admin-layout' },
        h('section', { class: 'admin-col', 'aria-labelledby': 'admin-users-heading' },
          h('h2', { id: 'admin-users-heading' }, icon('user'), ` ${t('admin.users')}`),
          adminUserCards(users, app.i18n, { selectedId: selected?.id, onDelete: onDeleteUser, onSetPassword })),
        h('section', { class: 'admin-col', id: 'admin-surveys', 'aria-labelledby': 'admin-surveys-heading' },
          h('h2', { id: 'admin-surveys-heading' }, selected ? t('admin.surveysOf', { name: selected.name }) : t('admin.surveysHeading')),
          selected ? adminSurveyCards(surveys, app.i18n, { onToggle, onDelete: onDeleteSurvey }) : emptyState(t('admin.pickUser')))),
    ],
  };
}

/** Container: the survey editor working on anyone's survey with the admin token (/..command/surveys/:id/edit). */
export async function adminEditorPage(app, route) {
  if (!app.adminToken) return { redirect: '/..command/' };
  return editorPage(app, route, {
    api: app.adminApi,
    cancelHref: (survey) => adminHref(survey.ownerId),
    savedHref: (survey) => withMsg(adminHref(survey.ownerId), 'saved'),
    backText: app.t('admin.back'),
  });
}
