import { safeEqual } from './auth.js';
import { HttpError, readForm, redirect } from './http.js';

function redirectToLogin(ctx) {
  const next = ctx.req.method === 'GET' ? ctx.url.pathname + ctx.url.search : '/surveys';
  redirect(ctx.res, `/login?next=${encodeURIComponent(next)}`);
}

/** Wraps a GET handler that requires a logged-in creator. */
export const authed = (handler) => (ctx) => {
  if (!ctx.user) return redirectToLogin(ctx);
  return handler(ctx);
};

/** Wraps a POST handler that requires a logged-in creator and a valid CSRF token. */
export const authedPost = (handler) => async (ctx) => {
  if (!ctx.user) return redirectToLogin(ctx);
  const form = await readForm(ctx.req);
  checkCsrf(ctx, form);
  return handler(ctx, form);
};

export function checkCsrf(ctx, form) {
  const expected = ctx.session?.csrf_token;
  if (!expected || !safeEqual(form.get('_csrf') ?? '', expected)) {
    throw new HttpError(403, 'error.csrf');
  }
}
