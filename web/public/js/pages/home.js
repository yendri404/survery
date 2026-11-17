import { APP_NAME } from '../components/layout.js';
import { h, withParts } from '../dom.js';

/** Start page; logged-in creators go straight to their surveys. */
export async function homePage(app) {
  if (app.user) return { redirect: '/surveys' };
  const { t } = app;
  const step = (n) => h('li', {}, withParts(t(`home.step${n}`), { action: h('strong', {}, t(`home.step${n}Action`)) }));
  return {
    title: APP_NAME,
    body: [h('section', { class: 'hero' },
      h('h1', {}, APP_NAME),
      h('p', { class: 'lead' }, t('home.lead')),
      h('ol', { class: 'steps' }, step(1), step(2), step(3)),
      h('div', { class: 'button-row' },
        h('a', { class: 'button big', href: '/login' }, t('home.logIn')),
        app.meta.allowRegistration ? h('a', { class: 'button big secondary', href: '/register' }, t('home.register')) : null))],
  };
}
