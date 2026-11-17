import { ApiError } from '../api.js';
import { errorList } from '../components/layout.js';
import { h, withParts } from '../dom.js';
import { safeNext } from '../format.js';

// Registration problems, in the order the form shows its inputs.
const REGISTER_FIELDS = ['name', 'email', 'password', 'confirm'];

/** Shows `messages` in a red box right before `form` (replacing the previous box). */
function showErrors(form, messages) {
  const old = form.previousElementSibling?.classList.contains('errors') ? form.previousElementSibling : null;
  const box = errorList(messages);
  if (old && box) old.replaceWith(box);
  else if (old) old.remove();
  else if (box) form.before(box);
}

/** Runs `action` with the submit button disabled, so a double click sends once. */
async function busy(form, action) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
}

export async function loginPage(app, { query }) {
  const next = safeNext(query.get('next'));
  if (app.user) return { redirect: next };
  const { t } = app;

  const email = h('input', { type: 'email', name: 'email', required: true, autofocus: true, autocomplete: 'username', inputmode: 'email' });
  const password = h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' });
  const form = h('form', { class: 'stack' },
    h('label', {}, `${t('form.email')} `, email),
    h('label', {}, `${t('form.password')} `, password),
    h('button', { type: 'submit', class: 'big' }, t('login.submit')));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(form, async () => {
      try {
        const session = await app.api.post('/auth/login', { email: email.value.trim(), password: password.value });
        app.setSession(session);
        await app.navigate(next);
      } catch (err) {
        password.value = '';
        showErrors(form, [app.error(err)]);
      }
    });
  });

  return {
    title: t('login.title'),
    body: [h('div', { class: 'panel narrow' },
      h('h1', {}, t('login.title')),
      h('p', { class: 'muted' }, t('login.subtitle')),
      form,
      app.meta.allowRegistration ? h('p', {}, withParts(t('login.noAccount'), { link: h('a', { href: '/register' }, t('login.createOne')) })) : null)],
    mounted: () => email.focus(),
  };
}

export async function registerPage(app) {
  if (!app.meta.allowRegistration) throw new ApiError(404, { code: 'registration_disabled' });
  if (app.user) return { redirect: '/surveys' };
  const { t } = app;

  const inputs = {
    name: h('input', { name: 'name', required: true, maxlength: 100, autocomplete: 'name' }),
    email: h('input', { type: 'email', name: 'email', required: true, maxlength: 254, autocomplete: 'username', inputmode: 'email' }),
    password: h('input', { type: 'password', name: 'password', required: true, minlength: 8, maxlength: 200, autocomplete: 'new-password' }),
    confirm: h('input', { type: 'password', name: 'confirm', required: true, minlength: 8, maxlength: 200, autocomplete: 'new-password' }),
  };
  const form = h('form', { class: 'stack' },
    h('label', {}, `${t('register.name')} `, inputs.name),
    h('label', {}, `${t('form.email')} `, inputs.email),
    h('label', {}, `${t('form.password')} `, h('span', { class: 'hint' }, t('register.passwordHint')), inputs.password),
    h('label', {}, `${t('register.confirm')} `, inputs.confirm),
    h('button', { type: 'submit', class: 'big' }, t('register.submit')));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(form, async () => {
      try {
        const body = Object.fromEntries(REGISTER_FIELDS.map((name) => [name, name.startsWith('pass') || name === 'confirm' ? inputs[name].value : inputs[name].value.trim()]));
        app.setSession(await app.api.post('/auth/register', body));
        await app.navigate('/surveys');
      } catch (err) {
        inputs.password.value = '';
        inputs.confirm.value = '';
        const fields = err instanceof ApiError ? err.fields : undefined;
        const messages = fields
          ? REGISTER_FIELDS.filter((name) => fields[name]).map((name) => app.error(new ApiError(422, fields[name])))
          : [app.error(err)];
        showErrors(form, messages);
      }
    });
  });

  return {
    title: t('register.title'),
    body: [h('div', { class: 'panel narrow' },
      h('h1', {}, t('register.title')),
      h('p', { class: 'muted' }, t('register.subtitle')),
      form,
      h('p', {}, withParts(t('register.haveAccount'), { link: h('a', { href: '/login' }, t('register.logIn')) })))],
  };
}
