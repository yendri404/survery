import { loginPage, registerPage } from './pages/auth.js';
import { detailPage } from './pages/detail.js';
import { editorPage } from './pages/editor.js';
import { homePage } from './pages/home.js';
import { respondPage, thanksPage } from './pages/respond.js';
import { surveyListPage } from './pages/surveys.js';

/**
 * The app's pages (the web server's APP_ROUTES list the same paths). `auth` pages need a logged-in
 * creator; `respondent` pages hide the account menu; `errorKeys` pick clearer messages for codes.
 */
export const ROUTES = [
  { path: '/', page: homePage },
  { path: '/login', page: loginPage },
  { path: '/register', page: registerPage },
  { path: '/surveys', page: surveyListPage, auth: true },
  { path: '/surveys/new', page: editorPage, auth: true },
  { path: '/surveys/:id', page: detailPage, auth: true, errorKeys: { not_found: 'error.surveyNotFound' } },
  { path: '/surveys/:id/edit', page: editorPage, auth: true, errorKeys: { not_found: 'error.surveyNotFound' } },
  { path: '/s/:token', page: respondPage, respondent: true, errorKeys: { not_found: 'respond.notFound' } },
  { path: '/s/:token/thanks', page: thanksPage, respondent: true, errorKeys: { not_found: 'respond.notFound' } },
];

const PARAMS = { id: '(\\d+)', token: '([A-Za-z0-9_-]+)' };
const compiled = ROUTES.map((route) => {
  const keys = [];
  const source = route.path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return PARAMS[key]; });
  return { route, keys, pattern: new RegExp(`^${source}$`) };
});

/** The route for a path and its parameters, or undefined (page not found). */
export function matchRoute(pathname) {
  for (const { route, keys, pattern } of compiled) {
    const m = pattern.exec(pathname);
    if (m) return { route, params: Object.fromEntries(keys.map((key, i) => [key, m[i + 1]])) };
  }
  return undefined;
}
