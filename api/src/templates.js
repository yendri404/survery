import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Survey templates: a survey's definition as a file that only this Sharevy can have made. The server
 * signs the content with a secret key (HMAC-SHA256) on export and checks the signature on import, so
 * an edited, hand-made or foreign file is refused ("unsupported"). The check is strict: any key this
 * module does not write, or a value of the wrong kind, makes the file unsupported too.
 *
 * Content is always rebuilt in one fixed key order before signing or checking, so the signature
 * covers exactly what `canonicalTemplate` returns. The content itself (types, limits, duplicates) is
 * validated later, like any survey, when the creator saves it.
 */
export const TEMPLATE_FORMAT = 'sharevy-survey-template';
export const TEMPLATE_VERSION = 1;

const TOP_KEYS = new Set(['format', 'version', 'title', 'description', 'requireName', 'fields']);
const FIELD_KEYS = new Set(['label', 'type', 'required', 'options', 'min', 'max']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (object, allowed) => Object.keys(object).every((key) => allowed.has(key));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** One question as a template writes it: options only when it has some, min/max only for scales. */
function templateField(field) {
  const out = { label: field.label, type: field.type, required: field.required === true };
  if (Array.isArray(field.options) && field.options.length) out.options = [...field.options];
  if (field.type === 'scale') {
    if (isNumber(field.min)) out.min = field.min;
    if (isNumber(field.max)) out.max = field.max;
  }
  return out;
}

/** The unsigned template of a stored survey (hydrated by repo.js). */
export function templateOf(survey) {
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    title: survey.title,
    description: survey.description,
    requireName: survey.requireName === true,
    fields: survey.fields.map(templateField),
  };
}

/** A received question in canonical form, or undefined when it has unknown keys or wrong kinds. */
function canonicalField(field) {
  if (!isObject(field) || !onlyKeys(field, FIELD_KEYS)) return undefined;
  if (typeof field.label !== 'string' || typeof field.type !== 'string' || typeof field.required !== 'boolean') return undefined;
  if (field.options !== undefined && !(Array.isArray(field.options) && field.options.length && field.options.every((o) => typeof o === 'string'))) return undefined;
  for (const bound of ['min', 'max']) if (field[bound] !== undefined && (field.type !== 'scale' || !isNumber(field[bound]))) return undefined;
  return templateField(field);
}

/** A received template (without its signature) in canonical form, or undefined when its shape is not one we write. */
export function canonicalTemplate(data) {
  if (!isObject(data) || !onlyKeys(data, TOP_KEYS)) return undefined;
  if (data.format !== TEMPLATE_FORMAT || data.version !== TEMPLATE_VERSION) return undefined;
  if (typeof data.title !== 'string' || typeof data.description !== 'string' || typeof data.requireName !== 'boolean') return undefined;
  if (!Array.isArray(data.fields) || !data.fields.length) return undefined;
  const fields = data.fields.map(canonicalField);
  if (fields.some((field) => !field)) return undefined;
  return { format: data.format, version: data.version, title: data.title, description: data.description, requireName: data.requireName, fields };
}

/** HMAC-SHA256 of the canonical JSON, base64url (43 characters). */
const signatureOf = (key, content) => createHmac('sha256', key).update(JSON.stringify(content)).digest('base64url');

/** The file to download: the template plus its signature. */
export const signTemplate = (key, content) => ({ ...content, signature: signatureOf(key, content) });

/**
 * The content of a received file when it is a template this server (or one sharing its key) exported
 * and nobody changed; undefined otherwise. The comparison takes the same time wherever it differs.
 */
export function verifyTemplate(key, data) {
  if (!isObject(data) || typeof data.signature !== 'string') return undefined;
  const { signature, ...rest } = data;
  const content = canonicalTemplate(rest);
  if (!content) return undefined;
  const expected = Buffer.from(signatureOf(key, content));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? content : undefined;
}
