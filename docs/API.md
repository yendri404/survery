# Sharevy REST API (v1)

JSON over HTTP for any client: the web client in `web/`, a mobile app, a script.
The server lives in `api/` (`npm start` there, or `npm run start:api` at the repository root).

> **TL;DR** — Base URL `http://<host>:3001/api/v1`. Send and receive `application/json`.
> Creators log in and send `Authorization: Bearer <token>`. Respondents need no account; they send
> `X-Device-Id` so each device answers a survey once. Every error is
> `{ "error": { "code", "message", ... } }`: show your own text for `code`, not `message`.

---

## Contents

1. [Conventions](#1-conventions)
2. [Errors](#2-errors)
3. [Server and metadata](#3-server-and-metadata)
4. [Accounts](#4-accounts)
5. [Surveys (creators)](#5-surveys-creators)
6. [Results (creators)](#6-results-creators)
7. [Live updates](#7-live-updates)
8. [Answering (respondents)](#8-answering-respondents)
9. [Configuration](#9-configuration)
10. [Error code reference](#10-error-code-reference)

---

## 1. Conventions

| Topic | Rule |
|-------|------|
| Base path | `/api/v1`. Anything else answers `404`. A breaking change gets `/api/v2`. |
| Bodies | `Content-Type: application/json`, a JSON **object**, at most 1 MB. An empty body counts as `{}`. |
| Dates | Calendar dates are `YYYY-MM-DD` in the **server's** time zone (`closesOn`, `today`). Instants are ISO 8601 UTC (`2026-11-17T10:00:00Z`). |
| Ids | Surveys and responses: integers. Questions (fields): 4–32 lowercase letters/digits. Public tokens: base64url text. |
| Auth | `Authorization: Bearer <token>` from login or register. Tokens last 7 days; the server stores only their SHA-256 hash. |
| Caching | Every response has `Cache-Control: no-store`. |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`, `Referrer-Policy: no-referrer`. |
| CORS | Origins listed in `CORS_ORIGINS` get `Access-Control-Allow-Origin` (their own origin) and may send `Authorization`, `Content-Type` and `X-Device-Id`. `Retry-After` and `Content-Disposition` are exposed. Preflight (`OPTIONS`) answers `204`. |

Status codes used: `200` OK, `201` created, `204` no content, `400` bad request, `401` not logged in,
`403` survey closed or expired, `404` not found, `405` wrong method (with `Allow`), `409` already answered,
`413` body too large, `415` not JSON, `422` validation failed, `429` too many attempts (with `Retry-After`), `500`.

---

## 2. Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some values are not valid.",
    "params": { "max": 200 },
    "fields": { "<fieldId or input name>": { "code": "required", "params": {}, "message": "This field is required." } },
    "errors": [ { "code": "title_required", "params": {}, "message": "Title is required." } ]
  }
}
```

| Key | Present | Meaning |
|-----|---------|---------|
| `code` | always | Stable `snake_case` id. Translate this. |
| `message` | always | English text, for logs and simple clients. |
| `params` | when the message has values | Values to put in your translation (`{ "minutes": 15 }`). |
| `fields` | 422 on register and on answers | One problem per input: register uses `name`, `email`, `password`, `confirm`; answers use the question id, plus `respondentName`. |
| `errors` | 422 on survey definitions and other lists | Problems in the order the server found them. |

Each entry of `fields` and `errors` is `{ code, params, message }`. The full list is in [section 10](#10-error-code-reference).

---

## 3. Server and metadata

### `GET /health`

```json
200 { "status": "ok" }
```

### `GET /meta`

Rules clients must not hard-code. No auth.

```json
200
{
  "fieldTypes": ["text", "textarea", "number", "email", "date", "select", "radio", "yesno", "checkbox"],
  "choiceTypes": ["select", "radio", "checkbox"],
  "yesNoValues": ["yes", "no"],
  "limits": { "title": 200, "description": 2000, "label": 300, "fields": 100, "options": 100, "option": 200,
              "text": 1000, "textarea": 10000, "respondentName": 100 },
  "defaultOpenDays": 10,
  "today": "2026-11-17",
  "csv": { "delimiters": ["comma", "semicolon"], "languages": ["en", "es"] },
  "allowRegistration": true,
  "deviceIdPattern": "^[A-Za-z0-9_-]{20,100}$"
}
```

- `choiceTypes`: the types whose options the creator writes. `yesno` has the fixed values `yesNoValues`.
- `today`: the server's date. Closing dates are compared with it, so use it for "default closing date" (`today + defaultOpenDays`) and "not in the past" checks.

---

## 4. Accounts

### `POST /auth/register`

Disabled (`404 registration_disabled`) when `ALLOW_REGISTRATION=false`.

```json
{ "name": "Ana", "email": "ana@corp.local", "password": "secret123", "confirm": "secret123" }
```

`confirm` is optional; when sent it must equal `password`.

```json
201 { "token": "q3J...", "user": { "id": 1, "name": "Ana", "email": "ana@corp.local" } }
```

```json
422
{ "error": { "code": "validation_failed", "message": "Some values are not valid.",
  "fields": { "email": { "code": "email_taken", "params": {}, "message": "An account with this email already exists." } } } }
```

Rules: `name` 1–100 characters (`name_invalid`), a valid `email` up to 254 (`email_invalid`),
`password` 8–200 characters (`password_length`), `confirm` equal to `password` (`password_mismatch`),
email not registered yet (`email_taken`, checked only when everything else is valid).

### `POST /auth/login`

```json
{ "email": "ANA@corp.local", "password": "secret123" }
```

The email is case-insensitive.

```json
200 { "token": "q3J...", "user": { "id": 1, "name": "Ana", "email": "ana@corp.local" } }
401 { "error": { "code": "invalid_credentials", "message": "Invalid email or password." } }
429 { "error": { "code": "too_many_login_attempts", "message": "Too many failed login attempts. Try again in 15 minute(s).", "params": { "minutes": 15 } } }
```

After `LOGIN_MAX_FAILURES` failures for the same email **and** IP within 15 minutes, login answers `429` with a
`Retry-After` header (seconds). A successful login clears the count. Unknown emails take as long as wrong passwords.

### `POST /auth/logout`

Ends the session of the Bearer token sent, if any. No body.

```
204
```

### `GET /me`

```json
200 { "user": { "id": 1, "name": "Ana", "email": "ana@corp.local" } }
401 { "error": { "code": "unauthorized", "message": "Log in to continue." } }
```

---

## 5. Surveys (creators)

All endpoints in sections 5–7 need `Authorization: Bearer <token>` (`401 unauthorized` otherwise).
A creator only sees their own surveys: another creator's survey answers `404 not_found`, exactly like a missing one.

### The survey object

```json
{
  "id": 7,
  "title": "Team lunch",
  "description": "Internal",
  "fields": [
    { "id": "3f9a0c1b2d4e", "label": "Department", "type": "radio", "required": true, "options": ["IT", "HR"] },
    { "id": "8b1c2d3e4f50", "label": "Work remotely?", "type": "yesno", "required": false, "options": [] }
  ],
  "isOpen": true,
  "status": "open",
  "closesOn": "2026-11-27",
  "responseCount": 3,
  "publicToken": "Xk2b9...",
  "shareUrl": "http://localhost:3000/s/Xk2b9...",
  "createdAt": "2026-11-17T10:00:00Z",
  "updatedAt": "2026-11-17T10:00:00Z"
}
```

| Field | Meaning |
|-------|---------|
| `status` | `open` accepts answers; `closed` was closed by the creator; `expired` passed `closesOn`. A survey accepts answers during its whole closing day (server time). |
| `shareUrl` | Link for respondents, in the **web client**: `${WEB_BASE_URL}/s/<publicToken>`. |
| `options` | Written by the creator for `select`, `radio`, `checkbox`; always `[]` for the others (`yesno` uses `yes` / `no`). |

### `GET /surveys`

Newest first. Items are survey objects **without** `fields`.

```json
200 { "surveys": [ { "id": 7, "title": "Team lunch", "status": "open", "responseCount": 3, "closesOn": "2026-11-27", "...": "..." } ] }
```

### `POST /surveys`

```json
{
  "title": "Team lunch",
  "description": "Internal",
  "closesOn": "2026-11-27",
  "fields": [
    { "label": "Department", "type": "radio", "required": true, "options": ["IT", "HR"] },
    { "label": "Work remotely?", "type": "yesno" }
  ]
}
```

```json
201 { "survey": { "...": "the survey object" } }
```

Rules (`422 validation_failed` with `errors`, in this order):

| Code | Params | When |
|------|--------|------|
| `title_required` / `title_too_long` | `max` | Title empty / longer than `limits.title` (it is trimmed) |
| `description_too_long` | `max` | Longer than `limits.description` |
| `closing_date_invalid` | | `closesOn` is not a real `YYYY-MM-DD` date. Empty or missing means `today + defaultOpenDays`. |
| `closing_date_past` | | `closesOn` before `today`, unless it is the survey's current date (editing an expired survey without changing its date) |
| `fields_invalid` | | `fields` is not an array |
| `fields_empty` / `fields_too_many` | `max` | No questions / more than `limits.fields` |
| `field_invalid` | `n` | Question `n` (1-based) is not an object |
| `label_required` / `label_too_long` | `n`, `max` | Question text empty / too long |
| `type_unknown` | `n` | `type` not in `fieldTypes` |
| `option_duplicate` | `n`, `option` | The same option twice in question `n` (trimmed, ignoring case) |
| `options_empty` / `options_too_many` / `option_too_long` | `n`, `max` | Choice question without options / too many / one too long |
| `label_duplicate` | `first`, `second` | Two questions with the same text (trimmed, ignoring case); listed after the other problems |

`options` may be an array or one string with one option per line; blank options are dropped.
`required` is true only when it is exactly `true`.

```json
422
{ "error": { "code": "validation_failed", "message": "Some values are not valid.", "errors": [
  { "code": "option_duplicate", "params": { "n": 1, "option": "IT" }, "message": "Field 1: the option \"IT\" is repeated. Each option must be different." },
  { "code": "label_duplicate", "params": { "first": 1, "second": 2 }, "message": "Fields 1 and 2 ask the same question. Each question must be different." }
] } }
```

### `GET /surveys/:id`

```json
200 { "survey": { "...": "the survey object" } }
```

### `PUT /surveys/:id`

Replaces title, description, closing date and questions. Same body and rules as `POST /surveys`.
**Send each existing question with its `id`**: questions keep their id, so existing answers still match.
Questions without a (valid, unused) id get a new one.

```json
200 { "survey": { "...": "the updated survey object" } }
```

### `PATCH /surveys/:id`

Opens or closes the survey.

```json
{ "isOpen": false }
```

```json
200 { "survey": { "...": "status is now closed" } }
422 { "error": { "code": "validation_failed", "message": "Some values are not valid.", "errors": [ { "code": "is_open_invalid", "params": {}, "message": "isOpen must be true or false." } ] } }
```

### `DELETE /surveys/:id`

Deletes the survey and all its responses.

```
204
```

---

## 6. Results (creators)

### `GET /surveys/:id/responses`

Newest first. `id` identifies the response across the whole API (use it to delete); `number` is its position in this
survey: 1, 2, 3... in arrival order, never reused after a deletion (the next response gets the next number), so a number
always names the same response, also in CSVs already exported. Show `number` to people.
`answers` maps question id to text, or to a list of options for `checkbox` (in the survey's option order).
Unanswered questions are `""` (or `[]`). `respondentName` is `null` for anonymous answers. Yes/no answers are `"yes"` / `"no"`.

```json
200
{ "responses": [
  { "id": 12, "number": 3, "submittedAt": "2026-11-17T10:05:00Z", "respondentName": "Marta Gómez",
    "answers": { "3f9a0c1b2d4e": "HR", "8b1c2d3e4f50": "yes" } }
] }
```

### `DELETE /surveys/:id/responses/:responseId`

`:responseId` is the response `id`, not its `number`.

```
204
```

Deleting a response that no longer exists is also `204`.

### `GET /surveys/:id/summary`

Key figures and chart data. The server counts; clients only draw.

```json
200
{
  "kpis": {
    "total": 3, "named": 2, "anonymous": 1,
    "lastResponseAt": "2026-11-17T10:05:00Z",
    "status": "open", "closesOn": "2026-11-27", "daysLeft": 10
  },
  "questions": [
    { "fieldId": "3f9a0c1b2d4e", "label": "Department", "type": "radio", "multiple": false, "answered": 3,
      "counts": [ { "option": "IT", "count": 2, "percent": 67 }, { "option": "HR", "count": 1, "percent": 33 } ] },
    { "fieldId": "8b1c2d3e4f50", "label": "Work remotely?", "type": "yesno", "multiple": false, "answered": 1,
      "counts": [ { "option": "yes", "count": 1, "percent": 100 }, { "option": "no", "count": 0, "percent": 0 } ] }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `lastResponseAt` | Newest response, or `null` |
| `daysLeft` | While `open`: whole days until `closesOn` (`0` = last day). `null` when closed or expired. |
| `questions` | Only choice questions (`select`, `radio`, `checkbox`, `yesno`), in survey order |
| `answered` | Responses that answered this question |
| `percent` | `round(count / answered * 100)`; `0` when nobody answered |
| `multiple` | `true` for `checkbox`: one person can pick several options, so percentages can add up to more than 100 |

For `yesno`, `option` is `yes` / `no`: translate it in the client.

### `GET /surveys/:id/export.csv`

| Query | Values | Default |
|-------|--------|---------|
| `delimiter` | `comma`, `semicolon` (Excel with regional settings that use `;`) | `comma` |
| `lang` | `en`, `es`: language of the fixed headers and of yes/no answers | `Accept-Language`, then `en` |

```
200
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="sharevy-survey-7-responses.csv"

﻿Response ID,Submitted at (UTC),Name,Department,Work remotely?\r\n
3,2026-11-17 10:05:00,Marta Gómez,HR,Yes\r\n
```

The first column is the response `number` within the survey (not the app-wide `id`).
UTF-8 with a BOM (so Excel reads accents), `\r\n` line ends, oldest response first, checkbox answers joined
with `", "`. Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'` (unless they are
plain numbers) so spreadsheets do not run them as formulas. Unknown values answer
`400 invalid_parameter` with `params.name` = `delimiter` or `lang`.

### `GET /surveys/:id/qr.svg` and `GET /surveys/:id/qr.png`

QR code of `shareUrl`. SVG: `image/svg+xml`, with `role="img"` and an English `aria-label`.
PNG: `image/png`, 600 px, `Content-Disposition: attachment; filename="sharevy-survey-7-qr.png"`.
Both need the Bearer header, so fetch them and show the result (for example as a blob URL).

---

## 7. Live updates

| Stream | Fires when |
|--------|------------|
| `GET /surveys/events` | Any of the creator's surveys is created, edited, opened/closed, deleted, answered, or loses a response |
| `GET /surveys/:id/events` | That survey changes in any of those ways |

Server-Sent Events (`text/event-stream`). The token travels **only** in the `Authorization` header
(a token in the URL is ignored), so read the stream with `fetch` and a body reader, not `EventSource`.

```
retry: 3000
: connected

event: change
data: 1763374000000

: ping
```

Events only say "something changed": re-fetch what you show. A `: ping` comment every 25 s keeps proxies
from closing the stream. Reconnect after errors; the server drops the subscription when the connection closes.

---

## 8. Answering (respondents)

No account. Send a stable device id in `X-Device-Id`: a random value you generate once and keep
(20–100 characters of `A–Z a–z 0–9 _ -`, see `deviceIdPattern`). The server stores only its hash.
A malformed value answers `400 invalid_device_id`. A new id counts as a new device.

### `GET /public/surveys/:token`

```json
200
{ "survey": {
  "title": "Team lunch", "description": "Internal", "closesOn": "2026-11-27", "status": "open",
  "fields": [ { "id": "3f9a0c1b2d4e", "label": "Department", "type": "radio", "required": true, "options": ["IT", "HR"] } ],
  "alreadyAnswered": false
} }
404 { "error": { "code": "not_found", "message": "This survey does not exist. Check the link you received." } }
```

`alreadyAnswered` is `true` when this `X-Device-Id` already answered. Show a closed message when `status` is not `open`.

### `POST /public/surveys/:token/responses`

```json
{ "respondentName": "Marta Gómez", "answers": { "3f9a0c1b2d4e": "HR", "c0ffee00": ["Mail", "Chat"] } }
```

`respondentName` is optional (trimmed; empty means anonymous). Each answer is a string, or a list of strings for
`checkbox`. Unknown question ids are ignored. Yes/no answers must be exactly `yes` or `no`.

```json
201 { "id": 12, "number": 3 }
201 { "id": 12, "number": 3, "deviceId": "Hq0RkT2x9VbYc1LmNoPq_w" }
```

`number` is the response's number within this survey (see `GET /surveys/:id/responses`). A rejected submission uses
up no number.

`deviceId` comes back only when no `X-Device-Id` was sent: the server picked one, so keep it and send it next time.
A device id the client sent is never echoed.

Checks, in this order:

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Unknown token |
| 400 | `invalid_device_id` | Malformed `X-Device-Id` |
| 403 | `survey_closed` | Closed by the creator |
| 403 | `survey_expired` (`params.date`) | Closing date passed |
| 409 | `already_answered` | This device already answered (also when two submissions race) |
| 429 | `too_many_responses` (`params.minutes`, `Retry-After`) | More than `SUBMISSION_LIMIT` responses for this survey from this IP in 10 minutes |
| 422 | `validation_failed` with `fields` | Answers do not follow the rules below |

| Field code | Params | When |
|------------|--------|------|
| `required` | | A required question has no answer |
| `invalid_option` | | `select`/`radio`/`checkbox`/`yesno` value not among its options |
| `too_long` | `max` | `text` over `limits.text`, `textarea` over `limits.textarea` |
| `invalid_number` | | `number` is not a finite number |
| `invalid_email` | | `email` is not an address (max 254) |
| `invalid_date` | | `date` is not a real `YYYY-MM-DD` date |
| `respondent_name_too_long` (key `respondentName`) | `max` | Name over `limits.respondentName` |

`answers` that is not an object answers `422` with `errors: [{ "code": "answers_invalid" }]`.

```json
422
{ "error": { "code": "validation_failed", "message": "Some values are not valid.", "fields": {
  "3f9a0c1b2d4e": { "code": "required", "params": {}, "message": "This field is required." },
  "respondentName": { "code": "respondent_name_too_long", "params": { "max": 100 }, "message": "Name must be at most 100 characters." }
} } }
```

The server is the source of truth: clients may check the same rules first, but the server checks everything again.

---

## 9. Configuration

Environment variables of the API process:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port. |
| `HOST` | `0.0.0.0` | Interface to bind. Behind the `web/` proxy use `127.0.0.1`, so the API is reachable only through it. |
| `DB_PATH` | `data/surveys.db` | SQLite file. Relative paths are resolved from the **repository root**, not the current folder. |
| `WEB_BASE_URL` | `http://localhost:3000` | Address of the web client, used for `shareUrl` and QR codes. Set it to the address people use on the network (e.g. `http://192.168.1.20:3000`). Falls back to `BASE_URL` when only that is set (setting of the single-server version). |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed to call the API; `*` allows any. |
| `ALLOW_REGISTRATION` | `true` | `false` disables `POST /auth/register` (create accounts with `npm run create-user -- <email> <name> <password>`). |
| `TRUST_PROXY` | `false` | `true` only behind a reverse proxy you control: the client IP comes from `X-Forwarded-For`. The `web/` server is such a proxy (it always overwrites that header), so run the API with `TRUST_PROXY=true` behind it, or every person counts as `127.0.0.1` for the rate limits. |
| `LOGIN_MAX_FAILURES` | `10` | Failed logins per email + IP every 15 minutes before `429`. |
| `SUBMISSION_LIMIT` | `60` | Responses per survey + IP every 10 minutes (`0` disables). |

The database schema only grows (additive migrations run on every start), so databases from earlier versions keep all their data.

---

## 10. Error code reference

| Code | Status | Message (English) |
|------|--------|-------------------|
| `unauthorized` | 401 | Log in to continue. |
| `not_found` | 404 | Not found. / Survey not found. / This survey does not exist. Check the link you received. |
| `method_not_allowed` | 405 | Method not allowed. |
| `malformed_url` | 400 | Malformed URL, or a request target that is not a plain path (absolute-form, `//host`, backslashes). |
| `invalid_json` | 400 | The request body is not valid JSON. |
| `invalid_body` | 400 | The request body must be a JSON object. |
| `invalid_parameter` | 400 | The query parameter {name} has an unsupported value. |
| `invalid_device_id` | 400 | The X-Device-Id header must be 20 to 100 letters, digits, "-" or "_". |
| `body_too_large` | 413 | The request body is too large. |
| `unsupported_media_type` | 415 | Send the body as application/json. |
| `validation_failed` | 422 | Some values are not valid. (details in `fields` / `errors`) |
| `registration_disabled` | 404 | Registration is disabled. Ask an administrator for an account. |
| `invalid_credentials` | 401 | Invalid email or password. |
| `too_many_login_attempts` | 429 | Too many failed login attempts. Try again in {minutes} minute(s). |
| `survey_closed` | 403 | This survey is closed and no longer accepts answers. |
| `survey_expired` | 403 | This survey closed on {date} and no longer accepts answers. |
| `already_answered` | 409 | You already answered this survey from this device. Thank you! |
| `too_many_responses` | 429 | Too many responses from this device. Try again in {minutes} minute(s). |
| `internal_error` | 500 | Something went wrong. Please try again. |

Validation codes (inside `fields` / `errors`): `name_invalid`, `email_invalid`, `password_length`,
`password_mismatch`, `email_taken`, `title_required`, `title_too_long`, `description_too_long`,
`closing_date_invalid`, `closing_date_past`, `fields_invalid`, `fields_empty`, `fields_too_many`,
`field_invalid`, `label_required`, `label_too_long`, `type_unknown`, `options_empty`, `options_too_many`,
`option_too_long`, `option_duplicate`, `label_duplicate`, `is_open_invalid`, `answers_invalid`,
`respondent_name_too_long`, `required`, `invalid_option`, `too_long`, `invalid_number`, `invalid_email`,
`invalid_date`. Their English texts live in `api/locales/en.json`; the key-to-code table is `api/src/errors.js`.
