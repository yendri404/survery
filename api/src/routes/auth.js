import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from '../auth.js';
import { ApiError, coded, tooManyRequests, validationFailed } from '../errors.js';
import { bearerToken, readJson, sendJson, sendNoContent } from '../http.js';
import { clientIp, createRateLimiter } from '../rate-limit.js';
import { isEmail } from '../surveys.js';

const text = (value) => (typeof value === 'string' ? value : '');
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });

/** Creator accounts: register, log in and out with Bearer tokens, and who am I. */
export function registerAuthRoutes({ route, repo, config }) {
  // Keyed by email+IP so an attacker cannot lock a colleague out from another machine.
  const loginFailures = createRateLimiter({ limit: config.loginMaxFailures, windowMs: config.loginWindowMs });

  /** New session: the client gets the token once; the database keeps only its hash. */
  function startSession(ctx, user, status) {
    repo.deleteExpiredSessions();
    const token = newToken();
    repo.createSession({ id: hashToken(token), userId: user.id, expiresAt: Date.now() + config.sessionTtlMs });
    sendJson(ctx.res, status, { token, user: publicUser(user) });
  }

  route('POST', '/auth/login', async (ctx) => {
    const body = await readJson(ctx.req);
    const email = text(body.email).trim();
    const password = text(body.password);
    const limitKey = `${email.toLowerCase()}|${clientIp(ctx.req, config.trustProxy)}`;

    if (loginFailures.isLimited(limitKey)) throw tooManyRequests('login.tooManyAttempts', loginFailures.retryAfterSeconds(limitKey));
    // Counted before the (slow) password check and cleared only on success: guesses sent all at
    // once cannot all pass the limit check before any of them is counted.
    loginFailures.hit(limitKey);

    const user = email ? repo.findUserByEmail(email) : undefined;
    // The dummy hash keeps the timing the same whether or not the account exists.
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) throw new ApiError(401, 'login.invalid');
    loginFailures.reset(limitKey);
    startSession(ctx, user, 200);
  });

  route('POST', '/auth/register', async (ctx) => {
    if (!config.allowRegistration) throw new ApiError(404, 'register.disabled');
    const body = await readJson(ctx.req);
    const values = { name: text(body.name).trim(), email: text(body.email).trim() };
    const password = text(body.password);
    const fields = {};

    if (!values.name || values.name.length > 100) fields.name = coded('register.nameInvalid');
    if (!isEmail(values.email)) fields.email = coded('register.emailInvalid');
    if (password.length < 8 || password.length > 200) fields.password = coded('register.passwordLength');
    // The confirmation is optional for API clients; when sent, it must match.
    if (body.confirm !== undefined && password !== text(body.confirm)) fields.confirm = coded('register.passwordMismatch');
    if (!Object.keys(fields).length && repo.findUserByEmail(values.email)) fields.email = coded('register.emailTaken');
    if (Object.keys(fields).length) throw validationFailed({ fields });

    const id = repo.createUser({ ...values, passwordHash: await hashPassword(password) });
    startSession(ctx, repo.findUserById(id), 201);
  });

  /** Ends the session of the token sent, if any. Always 204, so clients can call it blindly. */
  route('POST', '/auth/logout', (ctx) => {
    const token = bearerToken(ctx.req);
    if (token) repo.deleteSession(hashToken(token));
    sendNoContent(ctx.res);
  });

  route('GET', '/me', (ctx) => sendJson(ctx.res, 200, { user: ctx.user }), { auth: true });
}
