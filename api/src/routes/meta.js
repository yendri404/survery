import { SUPPORTED_LANGUAGES } from '../i18n.js';
import { sendJson } from '../http.js';
import { CHOICE_TYPES, DEFAULT_OPEN_DAYS, FIELD_TYPE_IDS, LIMITS, SCALE, YES_NO } from '../surveys.js';
import { DEVICE_ID } from './public.js';

/** Endpoints that describe the server, so clients never hard-code its rules. */
export function registerMetaRoutes({ route, config, today }) {
  route('GET', '/health', (ctx) => sendJson(ctx.res, 200, { status: 'ok' }));

  route('GET', '/meta', (ctx) => sendJson(ctx.res, 200, {
    fieldTypes: FIELD_TYPE_IDS,
    choiceTypes: [...CHOICE_TYPES],
    yesNoValues: YES_NO,
    limits: LIMITS,
    scale: SCALE,
    defaultOpenDays: DEFAULT_OPEN_DAYS,
    // The server's calendar date: closing dates are compared with it, not with the client's clock.
    today: today(),
    csv: { delimiters: ['comma', 'semicolon'], languages: SUPPORTED_LANGUAGES },
    allowRegistration: config.allowRegistration,
    deviceIdPattern: DEVICE_ID.source,
  }));
}
