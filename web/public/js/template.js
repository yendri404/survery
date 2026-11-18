/**
 * Survey templates: a survey's questions saved as a file (export) and read back to start a new survey
 * (import). Only the definition travels: no ids, answers, links, owner or dates. The importer checks
 * the shape only; the editor and the API check the content (types, limits, duplicates) as for any survey.
 */
export const TEMPLATE_FORMAT = 'sharevy-survey-template';
export const TEMPLATE_VERSION = 1;
/** Larger files are refused before reading them (a template is a few KB). */
export const TEMPLATE_MAX_BYTES = 1024 * 1024;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** One question as a template keeps it: options only when it has some, min/max only for scales. */
function templateField(field) {
  const out = { label: String(field.label ?? ''), type: String(field.type ?? 'text'), required: field.required === true };
  const options = Array.isArray(field.options) ? field.options.filter((o) => typeof o === 'string') : [];
  if (options.length) out.options = options;
  if (out.type === 'scale') {
    if (isNumber(field.min)) out.min = field.min;
    if (isNumber(field.max)) out.max = field.max;
  }
  return out;
}

/** The template of a survey (as the API sends it, with `fields`). */
export function surveyTemplate(survey) {
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    title: String(survey.title ?? ''),
    description: String(survey.description ?? ''),
    requireName: survey.requireName === true,
    fields: (survey.fields ?? []).map(templateField),
  };
}

/** "Team lunch: 2027?" -> "Team lunch 2027.sharevy.json" (characters files cannot hold are dropped). */
export function templateFileName(title) {
  const base = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${base || 'survey'}.sharevy.json`;
}

/**
 * Reads a template file's text: `{ template }` (only known keys kept), or `{ error }` with a message
 * key: not JSON or not an object (template.invalid), another kind of file (template.notSharevy), made
 * by a newer Sharevy (template.newerVersion), or without any question (template.noQuestions).
 */
export function parseTemplate(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'template.invalid' };
  }
  if (!isObject(data)) return { error: 'template.invalid' };
  if (data.format !== TEMPLATE_FORMAT || !Number.isInteger(data.version)) return { error: 'template.notSharevy' };
  if (data.version > TEMPLATE_VERSION) return { error: 'template.newerVersion' };
  const fields = Array.isArray(data.fields) ? data.fields.filter(isObject).map(templateField) : [];
  if (!fields.length) return { error: 'template.noQuestions' };
  return {
    template: {
      format: TEMPLATE_FORMAT,
      version: TEMPLATE_VERSION,
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      requireName: data.requireName === true,
      fields,
    },
  };
}
