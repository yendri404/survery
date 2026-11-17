import { defaultI18n } from './i18n.js';

/**
 * Message key (api/locales/en.json) -> stable machine code sent to clients.
 * Clients translate the code (with `params`); `message` is the English text, for logs and simple clients.
 * Codes never change once published: add new ones instead.
 */
export const ERROR_CODES = {
  // Survey definition (parseSurveyInput) and state
  'validation.titleRequired': 'title_required',
  'validation.titleTooLong': 'title_too_long',
  'validation.descriptionTooLong': 'description_too_long',
  'validation.closingDateInvalid': 'closing_date_invalid',
  'validation.closingDatePast': 'closing_date_past',
  'validation.requireNameInvalid': 'require_name_invalid',
  'validation.fieldsInvalid': 'fields_invalid',
  'validation.fieldsEmpty': 'fields_empty',
  'validation.fieldsTooMany': 'fields_too_many',
  'validation.fieldInvalid': 'field_invalid',
  'validation.labelRequired': 'label_required',
  'validation.labelTooLong': 'label_too_long',
  'validation.typeUnknown': 'type_unknown',
  'validation.optionsEmpty': 'options_empty',
  'validation.optionsTooMany': 'options_too_many',
  'validation.optionTooLong': 'option_too_long',
  'validation.optionDuplicate': 'option_duplicate',
  'validation.labelDuplicate': 'label_duplicate',
  'validation.scaleBoundInvalid': 'scale_bound_invalid',
  'validation.scaleOrder': 'scale_order',
  'validation.scaleTooWide': 'scale_too_wide',
  'validation.isOpenInvalid': 'is_open_invalid',
  // Answers (validateAnswers, parseRespondentName)
  'validation.answersInvalid': 'answers_invalid',
  'validation.respondentNameRequired': 'respondent_name_required',
  'validation.respondentNameTooLong': 'respondent_name_too_long',
  'validation.required': 'required',
  'validation.invalidOption': 'invalid_option',
  'validation.tooLong': 'too_long',
  'validation.number': 'invalid_number',
  'validation.email': 'invalid_email',
  'validation.date': 'invalid_date',
  'validation.scaleRange': 'invalid_scale_value',
  // Accounts
  'register.nameInvalid': 'name_invalid',
  'register.emailInvalid': 'email_invalid',
  'register.passwordLength': 'password_length',
  'register.passwordMismatch': 'password_mismatch',
  'register.emailTaken': 'email_taken',
  'register.disabled': 'registration_disabled',
  'login.invalid': 'invalid_credentials',
  'login.tooManyAttempts': 'too_many_login_attempts',
  // Respondents
  'respond.notFound': 'not_found',
  'respond.alreadyAnswered': 'already_answered',
  'respond.closed': 'survey_closed',
  'respond.closedOn': 'survey_expired',
  'respond.tooManyResponses': 'too_many_responses',
  // Protocol
  'error.generic': 'internal_error',
  'error.notFound': 'not_found',
  'error.surveyNotFound': 'not_found',
  'error.methodNotAllowed': 'method_not_allowed',
  'error.malformedUrl': 'malformed_url',
  'error.unauthorized': 'unauthorized',
  'error.validation': 'validation_failed',
  'error.unsupportedMediaType': 'unsupported_media_type',
  'error.bodyTooLarge': 'body_too_large',
  'error.invalidJson': 'invalid_json',
  'error.invalidBody': 'invalid_body',
  'error.invalidDeviceId': 'invalid_device_id',
  'error.invalidParameter': 'invalid_parameter',
};

/**
 * Translator for the domain functions (parseSurveyInput, validateAnswers, parseRespondentName):
 * instead of a sentence it returns `{ code, params, message }`, so each problem reaches the
 * client as a code it can translate.
 */
export const coded = (key, params = {}) => ({ code: ERROR_CODES[key] ?? key, params, message: defaultI18n.t(key, params) });

/**
 * An error answered as `{ "error": { code, message, params?, fields?, errors? } }`.
 * `key` is a message key from ERROR_CODES; `details` may add `fields` (id -> coded problem) or `errors` (list).
 */
export class ApiError extends Error {
  constructor(status, key, params = {}, details = {}) {
    super(defaultI18n.t(key, params));
    this.status = status;
    this.code = ERROR_CODES[key] ?? key;
    this.params = params;
    this.details = details;
  }

  toJSON() {
    const error = { code: this.code, message: this.message };
    if (Object.keys(this.params).length) error.params = this.params;
    if (this.details.fields) error.fields = this.details.fields;
    if (this.details.errors) error.errors = this.details.errors;
    return { error };
  }
}

/** 429 for a rate limit: `params.minutes` for the message and a Retry-After header, in seconds. */
export function tooManyRequests(key, retryAfterSeconds) {
  const err = new ApiError(429, key, { minutes: Math.ceil(retryAfterSeconds / 60) });
  err.headers = { 'Retry-After': String(retryAfterSeconds) };
  return err;
}

/** 422 with per-field problems and/or a list of general problems (each from `coded`). */
export const validationFailed = (details) => new ApiError(422, 'error.validation', {}, details);
