/**
 * API error code -> message key in web/locales. The API sends stable codes (docs/API.md,
 * section 10); the client shows its own text for them, in the reader's language.
 * `api_unavailable` comes from the web server's proxy; `network_error` from fetch itself.
 */
export const ERROR_KEYS = {
  // Survey definition and state
  title_required: 'validation.titleRequired',
  title_too_long: 'validation.titleTooLong',
  description_too_long: 'validation.descriptionTooLong',
  closing_date_invalid: 'validation.closingDateInvalid',
  closing_date_past: 'validation.closingDatePast',
  fields_invalid: 'validation.fieldsInvalid',
  fields_empty: 'validation.fieldsEmpty',
  fields_too_many: 'validation.fieldsTooMany',
  field_invalid: 'validation.fieldInvalid',
  label_required: 'validation.labelRequired',
  label_too_long: 'validation.labelTooLong',
  type_unknown: 'validation.typeUnknown',
  options_empty: 'validation.optionsEmpty',
  options_too_many: 'validation.optionsTooMany',
  option_too_long: 'validation.optionTooLong',
  option_duplicate: 'validation.optionDuplicate',
  label_duplicate: 'validation.labelDuplicate',
  is_open_invalid: 'validation.isOpenInvalid',
  // Answers
  answers_invalid: 'validation.answersInvalid',
  respondent_name_too_long: 'validation.respondentNameTooLong',
  required: 'validation.required',
  invalid_option: 'validation.invalidOption',
  too_long: 'validation.tooLong',
  invalid_number: 'validation.number',
  invalid_email: 'validation.email',
  invalid_date: 'validation.date',
  // Accounts
  name_invalid: 'register.nameInvalid',
  email_invalid: 'register.emailInvalid',
  password_length: 'register.passwordLength',
  password_mismatch: 'register.passwordMismatch',
  email_taken: 'register.emailTaken',
  registration_disabled: 'register.disabled',
  invalid_credentials: 'login.invalid',
  too_many_login_attempts: 'login.tooManyAttempts',
  // Respondents
  already_answered: 'respond.alreadyAnswered',
  survey_closed: 'respond.closed',
  survey_expired: 'respond.closedOn',
  too_many_responses: 'respond.tooManyResponses',
  // Protocol
  not_found: 'error.notFound',
  internal_error: 'error.generic',
  method_not_allowed: 'error.methodNotAllowed',
  malformed_url: 'error.malformedUrl',
  unauthorized: 'error.unauthorized',
  validation_failed: 'error.validation',
  unsupported_media_type: 'error.unsupportedMediaType',
  body_too_large: 'error.bodyTooLarge',
  invalid_json: 'error.invalidJson',
  invalid_body: 'error.invalidBody',
  invalid_device_id: 'error.invalidDeviceId',
  invalid_parameter: 'error.invalidParameter',
  api_unavailable: 'error.apiUnavailable',
  network_error: 'error.network',
};

/**
 * Text for one API problem `{ code, params, message }`. `keys` overrides the key of a code where
 * the page knows better ("not_found" on a share link means "this survey does not exist").
 * Unknown codes (from a newer API) show the API's English message.
 */
export function errorMessage(problem, t, keys = {}) {
  const key = keys[problem?.code] ?? ERROR_KEYS[problem?.code];
  if (key) return t(key, problem.params ?? {});
  return problem?.message || t('error.generic');
}
