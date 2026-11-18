import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from '../auth.js';
import { ApiError, coded, tooManyRequests, validationFailed } from '../errors.js';
import { bearerToken, isoUtc, readJson, sendJson, sendNoContent } from '../http.js';
import { clientIp, createRateLimiter } from '../rate-limit.js';
import { surveyTools } from './surveys.js';

const text = (value) => (typeof value === 'string' ? value : '');
const MASTER_MIN = 12;
const MAX_PASSWORD = 200;
const USER_MIN = 8; // same rule as registration

/**
 * Admin panel of the instance: one master password (the single `admin` row), created by the first
 * POST /admin/setup and replaced only by deleting that row in the database. Its sessions are separate
 * from creator sessions: an admin token never opens creator endpoints and the other way round.
 * Every route except status, setup and login needs the admin token (`admin: true`).
 */
export function registerAdminRoutes({ route, repo, config, today, live }) {
  const guarded = (method, path, handler) => route(method, path, handler, { admin: true });
  const { surveyJson, readDefinition, changeState } = surveyTools({ repo, config, today });
  // Keyed by IP only: there is a single password to guess.
  const loginFailures = createRateLimiter({ limit: config.loginMaxFailures, windowMs: config.loginWindowMs });

  function startSession(ctx, admin, status) {
    repo.deleteStaleAdminSessions();
    const token = newToken();
    repo.createAdminSession({ id: hashToken(token), sessionKey: admin.session_key, expiresAt: Date.now() + config.adminSessionTtlMs });
    sendJson(ctx.res, status, { token });
  }

  /** Whether the master password exists, so the admin page shows "create" or "log in". */
  route('GET', '/admin/status', (ctx) => sendJson(ctx.res, 200, { configured: Boolean(repo.getAdmin()) }));

  /** Creates the master password: only while none exists (the first request wins), then logs in. */
  route('POST', '/admin/setup', async (ctx) => {
    if (repo.getAdmin()) throw new ApiError(409, 'admin.exists');
    const body = await readJson(ctx.req);
    const password = text(body.password);
    const fields = {};
    if (password.length < MASTER_MIN || password.length > MAX_PASSWORD) fields.password = coded('admin.passwordLength');
    if (body.confirm !== undefined && password !== text(body.confirm)) fields.confirm = coded('register.passwordMismatch');
    if (Object.keys(fields).length) throw validationFailed({ fields });
    // Hashing takes a while: another setup may have won meanwhile, and the insert refuses a second row.
    const created = repo.createAdmin({ passwordHash: await hashPassword(password), sessionKey: newToken() });
    if (!created) throw new ApiError(409, 'admin.exists');
    startSession(ctx, repo.getAdmin(), 201);
  });

  route('POST', '/admin/login', async (ctx) => {
    const body = await readJson(ctx.req);
    const limitKey = clientIp(ctx.req, config.trustProxy);
    if (loginFailures.isLimited(limitKey)) throw tooManyRequests('login.tooManyAttempts', loginFailures.retryAfterSeconds(limitKey));
    // Counted before the (slow) password check and cleared only on success: guesses sent all at
    // once cannot all pass the limit check before any of them is counted.
    loginFailures.hit(limitKey);
    const admin = repo.getAdmin();
    // Checked even without an admin, so timing says nothing more than the status endpoint does.
    const valid = await verifyPassword(text(body.password), admin?.password_hash ?? DUMMY_HASH);
    if (!admin) throw new ApiError(409, 'admin.notConfigured');
    if (!valid) throw new ApiError(401, 'login.invalid');
    loginFailures.reset(limitKey);
    startSession(ctx, admin, 200);
  });

  /** Ends the admin session of the token sent, if any. Always 204. */
  route('POST', '/admin/logout', (ctx) => {
    const token = bearerToken(ctx.req);
    if (token) repo.deleteAdminSession(hashToken(token));
    sendNoContent(ctx.res);
  });

  // ---------- Users ----------
  function userParam(ctx) {
    const id = Number(ctx.params.id);
    const user = Number.isSafeInteger(id) ? repo.findUserById(id) : undefined;
    if (!user) throw new ApiError(404, 'error.userNotFound');
    return user;
  }

  guarded('GET', '/admin/users', (ctx) => {
    const users = repo.listUsers().map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: isoUtc(u.created_at), surveyCount: u.survey_count }));
    sendJson(ctx.res, 200, { users });
  });

  /** Sets a new password for a user (8 to 200 characters, like registration) and ends their sessions. */
  guarded('PUT', '/admin/users/:id/password', async (ctx) => {
    const user = userParam(ctx);
    const password = text((await readJson(ctx.req)).password);
    if (password.length < USER_MIN || password.length > MAX_PASSWORD) throw validationFailed({ fields: { password: coded('register.passwordLength') } });
    repo.setUserPassword(user.id, await hashPassword(password));
    sendNoContent(ctx.res);
  });

  /** Deletes a user with all their surveys and answers. */
  guarded('DELETE', '/admin/users/:id', (ctx) => {
    const user = userParam(ctx);
    const surveys = repo.listSurveys(user.id);
    repo.deleteUser(user.id);
    for (const survey of surveys) live.surveyChanged(survey);
    sendNoContent(ctx.res);
  });

  guarded('GET', '/admin/users/:id/surveys', (ctx) => {
    const user = userParam(ctx);
    const surveys = repo.listSurveys(user.id).map((s) => ({ ...surveyJson(ctx, s, { withFields: false }), ownerId: s.ownerId }));
    sendJson(ctx.res, 200, { surveys });
  });

  // ---------- Surveys (any owner) ----------
  function surveyParam(ctx) {
    const id = Number(ctx.params.id);
    const survey = Number.isSafeInteger(id) ? repo.getSurvey(id) : undefined;
    if (!survey) throw new ApiError(404, 'error.surveyNotFound');
    return survey;
  }
  const sendSurvey = (ctx, status, id) => {
    const survey = repo.getSurvey(id);
    sendJson(ctx.res, status, { survey: { ...surveyJson(ctx, survey), ownerId: survey.ownerId } });
  };

  guarded('GET', '/admin/surveys/:id', (ctx) => sendSurvey(ctx, 200, surveyParam(ctx).id));

  /** Edits a survey with the same rules as its owner's editor; the owner's open pages refresh. */
  guarded('PUT', '/admin/surveys/:id', async (ctx) => {
    const survey = surveyParam(ctx);
    const value = await readDefinition(ctx, survey);
    repo.updateSurvey(survey.id, survey.ownerId, value);
    live.surveyChanged(survey);
    sendSurvey(ctx, 200, survey.id);
  });

  /** Close, reopen or public results, like the owner's PATCH /surveys/:id. */
  guarded('PATCH', '/admin/surveys/:id', async (ctx) => {
    const survey = surveyParam(ctx);
    await changeState(ctx, survey);
    live.surveyChanged(survey);
    sendSurvey(ctx, 200, survey.id);
  });

  guarded('DELETE', '/admin/surveys/:id', (ctx) => {
    const survey = surveyParam(ctx);
    repo.deleteSurvey(survey.id, survey.ownerId);
    live.surveyChanged(survey);
    sendNoContent(ctx.res);
  });
}
