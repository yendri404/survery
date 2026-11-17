import { DUMMY_HASH, hashPassword, hashSessionId, newToken, verifyPassword } from '../auth.js';
import { checkCsrf } from '../guards.js';
import { HttpError, readForm, redirect, safeNext, sendHtml } from '../http.js';
import { clientIp, createRateLimiter } from '../rate-limit.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionCookie(config, id, maxAgeSeconds) {
  return `sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${config.cookieSecure ? '; Secure' : ''}`;
}

export function registerAuthRoutes({ route, repo, config, views, ui }) {
  // Keyed by email+IP so an attacker cannot lock a colleague out from another machine.
  const loginFailures = createRateLimiter({ limit: config.loginMaxFailures, windowMs: config.loginWindowMs });

  function startSession(ctx, userId, next) {
    if (ctx.session) repo.deleteSession(ctx.session.id);
    repo.deleteExpiredSessions();
    const id = newToken();
    repo.createSession({ id: hashSessionId(id), userId, csrfToken: newToken(), expiresAt: Date.now() + config.sessionTtlMs });
    redirect(ctx.res, next, { 'Set-Cookie': sessionCookie(config, id, Math.floor(config.sessionTtlMs / 1000)) });
  }

  route('GET', '/', (ctx) => {
    if (ctx.user) return redirect(ctx.res, '/surveys');
    sendHtml(ctx.res, 200, views.homePage({ ...ui(ctx), allowRegistration: config.allowRegistration }));
  });

  route('GET', '/login', (ctx) => {
    const next = safeNext(ctx.url.searchParams.get('next'));
    if (ctx.user) return redirect(ctx.res, next);
    sendHtml(ctx.res, 200, views.loginPage({ ...ui(ctx), next, allowRegistration: config.allowRegistration }));
  });

  route('POST', '/login', async (ctx) => {
    const form = await readForm(ctx.req);
    const email = (form.get('email') ?? '').trim();
    const password = form.get('password') ?? '';
    const next = safeNext(form.get('next'));
    const limitKey = `${email.toLowerCase()}|${clientIp(ctx.req, config.trustProxy)}`;

    if (loginFailures.isLimited(limitKey)) {
      const retryAfter = loginFailures.retryAfterSeconds(limitKey);
      ctx.res.setHeader('Retry-After', String(retryAfter));
      return sendHtml(ctx.res, 429, views.loginPage({
        ...ui(ctx), next, email, allowRegistration: config.allowRegistration,
        error: ctx.i18n.t('login.tooManyAttempts', { minutes: Math.ceil(retryAfter / 60) }),
      }));
    }

    const user = email ? repo.findUserByEmail(email) : undefined;
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) {
      loginFailures.hit(limitKey);
      return sendHtml(ctx.res, 401, views.loginPage({
        ...ui(ctx), next, email, error: ctx.i18n.t('login.invalid'), allowRegistration: config.allowRegistration,
      }));
    }
    loginFailures.reset(limitKey);
    startSession(ctx, user.id, next);
  });

  route('GET', '/register', (ctx) => {
    if (!config.allowRegistration) throw new HttpError(404, 'register.disabled');
    if (ctx.user) return redirect(ctx.res, '/surveys');
    sendHtml(ctx.res, 200, views.registerPage({ ...ui(ctx) }));
  });

  route('POST', '/register', async (ctx) => {
    if (!config.allowRegistration) throw new HttpError(404, 'register.disabled');
    const form = await readForm(ctx.req);
    const values = { name: (form.get('name') ?? '').trim(), email: (form.get('email') ?? '').trim() };
    const password = form.get('password') ?? '';
    const errors = [];
    const { t } = ctx.i18n;

    if (!values.name || values.name.length > 100) errors.push(t('register.nameInvalid'));
    if (!EMAIL.test(values.email) || values.email.length > 254) errors.push(t('register.emailInvalid'));
    if (password.length < 8 || password.length > 200) errors.push(t('register.passwordLength'));
    if (password !== (form.get('confirm') ?? '')) errors.push(t('register.passwordMismatch'));
    if (!errors.length && repo.findUserByEmail(values.email)) errors.push(t('register.emailTaken'));

    if (errors.length) return sendHtml(ctx.res, 422, views.registerPage({ ...ui(ctx), values, errors }));

    const userId = repo.createUser({ ...values, passwordHash: await hashPassword(password) });
    startSession(ctx, userId, '/surveys');
  });

  route('POST', '/logout', async (ctx) => {
    const form = await readForm(ctx.req);
    if (ctx.session) {
      checkCsrf(ctx, form);
      repo.deleteSession(ctx.session.id);
    }
    redirect(ctx.res, '/', { 'Set-Cookie': sessionCookie(config, '', 0) });
  });
}
