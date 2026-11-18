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
9. [Public results](#9-public-results)
10. [Admin panel](#10-admin-panel)
11. [Configuration](#11-configuration)
12. [Error code reference](#12-error-code-reference)

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

Each entry of `fields` and `errors` is `{ code, params, message }`. The full list is in [section 12](#12-error-code-reference).

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
  "fieldTypes": ["text", "textarea", "number", "scale", "email", "date", "select", "radio", "yesno", "checkbox"],
  "choiceTypes": ["select", "radio", "checkbox"],
  "yesNoValues": ["yes", "no"],
  "limits": { "title": 200, "description": 2000, "label": 300, "fields": 100, "options": 100, "option": 200,
              "text": 1000, "textarea": 10000, "respondentName": 100 },
  "scale": { "defaultMin": 1, "defaultMax": 10, "lowest": -1000, "highest": 1000, "maxSteps": 100 },
  "defaultOpenDays": 10,
  "today": "2026-11-17",
  "csv": { "delimiters": ["comma", "semicolon", "auto"], "languages": ["en", "es", "pt"] },
  "allowRegistration": true,
  "deviceIdPattern": "^[A-Za-z0-9_-]{20,100}$"
}
```

- `choiceTypes`: the types whose options the creator writes. `yesno` has the fixed values `yesNoValues`.
- `scale`: rules of `scale` (slider) questions: the range a new one gets (`defaultMin`..`defaultMax`), the bounds
  both ends must stay within (`lowest`..`highest`) and the most steps between them (`maxSteps`). Steps are always 1.
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
    { "id": "8b1c2d3e4f50", "label": "Work remotely?", "type": "yesno", "required": false, "options": [] },
    { "id": "c0ffee123456", "label": "How satisfied are you?", "type": "scale", "required": true, "options": [], "min": 1, "max": 5 }
  ],
  "isOpen": true,
  "status": "open",
  "closesOn": "2026-11-27",
  "requireName": false,
  "responseCount": 3,
  "publicToken": "Xk2b9...",
  "shareUrl": "http://localhost:3000/s/Xk2b9...",
  "publicResults": false,
  "resultsUrl": null,
  "createdAt": "2026-11-17T10:00:00Z",
  "updatedAt": "2026-11-17T10:00:00Z"
}
```

| Field | Meaning |
|-------|---------|
| `status` | `open` accepts answers; `closed` was closed by the creator; `expired` passed `closesOn`. A survey accepts answers during its whole closing day (server time). |
| `requireName` | `true` when respondents must write their name to send an answer; `false` (the default) when the name is optional. |
| `shareUrl` | Link for respondents, in the **web client**: `${WEB_BASE_URL}/s/<publicToken>`. Without `WEB_BASE_URL`, the base is the address the client used, from `X-Forwarded-Proto` + `X-Forwarded-Host` (only with `TRUST_PROXY`; the host must be `hostname[:port]`), else `http://localhost:3000`. |
| `publicResults` | `true` while the results are public (see [Public results](#9-public-results)); `false` (the default) otherwise. |
| `resultsUrl` | While `publicResults` is `true`: the public results page in the web client, `<base>/r/<resultsToken>`, with the same base as `shareUrl`. `null` while the results are private. |
| `options` | Written by the creator for `select`, `radio`, `checkbox`; always `[]` for the others (`yesno` uses `yes` / `no`). |
| `min`, `max` | Only on `scale` questions: the whole numbers at both ends of the slider (step 1). Other types never carry them. |

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
  "requireName": true,
  "fields": [
    { "label": "Department", "type": "radio", "required": true, "options": ["IT", "HR"] },
    { "label": "Work remotely?", "type": "yesno" },
    { "label": "How satisfied are you?", "type": "scale", "min": 1, "max": 5 }
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
| `require_name_invalid` | | `requireName` is present but not `true` or `false` (`"yes"`, `1`, `null`...) |
| `fields_invalid` | | `fields` is not an array |
| `fields_empty` / `fields_too_many` | `max` | No questions / more than `limits.fields` |
| `field_invalid` | `n` | Question `n` (1-based) is not an object |
| `label_required` / `label_too_long` | `n`, `max` | Question text empty / too long |
| `type_unknown` | `n` | `type` not in `fieldTypes` |
| `option_duplicate` | `n`, `option` | The same option twice in question `n` (trimmed, ignoring case) |
| `options_empty` / `options_too_many` / `option_too_long` | `n`, `max` | Choice question without options / too many / one too long |
| `scale_bound_invalid` | `n`, `lowest`, `highest` | Scale question `n`: `min` or `max` is not a whole number within `scale.lowest`..`scale.highest` |
| `scale_order` | `n` | Scale question `n`: `min` is not lower than `max` |
| `scale_too_wide` | `n`, `maxSteps` | Scale question `n`: `max - min` is over `scale.maxSteps` |
| `label_duplicate` | `first`, `second` | Two questions with the same text (trimmed, ignoring case); listed after the other problems |

`options` may be an array or one string with one option per line; blank options are dropped.
`required` is true only when it is exactly `true`.
`requireName` is optional: left out, a new survey gets `false` (the name stays optional).
For `scale`, `min` and `max` may be numbers or whole-number strings (`"3"`); a missing (or `null` / `""`) end takes
`scale.defaultMin` / `scale.defaultMax`, so a scale is 1 to 10 by default. Other types drop `min` / `max`.
Changing a scale's range later does not rewrite existing answers: they are shown and exported as stored.

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

Replaces title, description, closing date, `requireName` and questions. Same body and rules as `POST /surveys`,
except that a body **without** `requireName` keeps the survey's current value (older clients do not reset it);
send `false` to make the name optional again.
**Send each existing question with its `id`**: questions keep their id, so existing answers still match.
Questions without a (valid, unused) id get a new one.

```json
200 { "survey": { "...": "the updated survey object" } }
```

### `PATCH /surveys/:id`

Opens or closes the survey (`isOpen`), and/or makes its results public or private (`publicResults`,
see [Public results](#9-public-results)). A field left out keeps its value; a body without
`publicResults` must have `isOpen`. Both are booleans.

```json
{ "isOpen": false }
{ "publicResults": true }
{ "isOpen": true, "publicResults": false }
```

`publicResults: true` keeps the current `resultsUrl`, or makes one; `false` deletes it for good (turning it on
again makes a new link). Both notify the live streams of the survey.

```json
200 { "survey": { "...": "status is now closed" } }
422 { "error": { "code": "validation_failed", "message": "Some values are not valid.", "errors": [ { "code": "is_open_invalid", "params": {}, "message": "isOpen must be true or false." } ] } }
422 { "error": { "code": "validation_failed", "message": "Some values are not valid.", "errors": [ { "code": "public_results_invalid", "params": {}, "message": "publicResults must be true or false." } ] } }
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
Like `number` answers, `scale` answers are stored as text: the chosen whole number written plainly (`"4"`, `"-2"`;
`"04"` is stored as `"4"`), or `""` when unanswered.
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
      "counts": [ { "option": "yes", "count": 1, "percent": 100 }, { "option": "no", "count": 0, "percent": 0 } ] },
    { "fieldId": "c0ffee123456", "label": "How satisfied are you?", "type": "scale", "multiple": false, "answered": 3,
      "counts": [ { "option": "1", "count": 0, "percent": 0 }, { "option": "2", "count": 1, "percent": 33 },
                  { "option": "3", "count": 0, "percent": 0 }, { "option": "4", "count": 0, "percent": 0 },
                  { "option": "5", "count": 2, "percent": 67 } ],
      "scale": { "min": 1, "max": 5, "average": 4, "median": 5, "outOfRange": 0 } }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `lastResponseAt` | Newest response, or `null` |
| `daysLeft` | While `open`: whole days until `closesOn` (`0` = last day). `null` when closed or expired. |
| `questions` | Only choice and scale questions (`select`, `radio`, `checkbox`, `yesno`, `scale`), in survey order |
| `answered` | Responses that answered this question |
| `percent` | `round(count / answered * 100)`; `0` when nobody answered |
| `multiple` | `true` for `checkbox`: one person can pick several options, so percentages can add up to more than 100 |

For `yesno`, `option` is `yes` / `no`: translate it in the client.

For `scale`, `counts` has one entry per whole number from `min` to `max` (as text, zeros included), and `scale` adds
`average` (rounded to 1 decimal) and `median` (the mean of the two middle answers when their number is even), both
`null` without answers. An answer left outside the range by a later range change counts in `answered`, `average` and
`median` but in no `counts` entry; `outOfRange` says how many there are.

### `GET /surveys/:id/export.csv`

| Query | Values | Default |
|-------|--------|---------|
| `delimiter` | `comma`, `semicolon` (Excel with regional settings that use `;`), or `auto`: `semicolon` when some `number` answer has decimals, `comma` otherwise (what the web client uses) | `comma` |
| `lang` | `en`, `es`, `pt`: language of the fixed headers and of yes/no answers | `Accept-Language`, then `en` |
| `tz` | IANA time zone (`America/Caracas`): submission times are shown in that zone and the header names it (`Submitted at (America/Caracas)`). The web client sends the viewer's zone. An unknown zone is a `400 invalid_parameter` (`params.name: "tz"`) | UTC (`Submitted at (UTC)`) |

```
200
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="Team lunch.csv"; filename*=UTF-8''Team%20lunch.csv

﻿Response #,Submitted at (UTC),Name,Department,Work remotely?\r\n
3,2026-11-17 10:05:00,Marta Gómez,HR,Yes\r\n
```

The first column is the response `number` within the survey (not the app-wide `id`).
The file is named after the survey title (characters file systems refuse removed, at most 100; `survey-<id>` if nothing is left), with an ASCII `filename` and the exact UTF-8 `filename*`. UTF-8 with a BOM (so Excel reads accents), `\r\n` line ends, oldest response first, checkbox answers joined
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
| `GET /public/results/:token/events` | The same as `GET /surveys/:id/events`, for a public results link (no token; see [Public results](#9-public-results)) |

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
  "title": "Team lunch", "description": "Internal", "closesOn": "2026-11-27", "status": "open", "requireName": true,
  "fields": [ { "id": "3f9a0c1b2d4e", "label": "Department", "type": "radio", "required": true, "options": ["IT", "HR"] } ],
  "alreadyAnswered": false
} }
404 { "error": { "code": "not_found", "message": "This survey does not exist. Check the link you received." } }
```

`alreadyAnswered` is `true` when this `X-Device-Id` already answered. Show a closed message when `status` is not `open`.
`requireName` tells the form whether the respondent name is required (`true`) or optional (`false`).

### `POST /public/surveys/:token/responses`

```json
{ "respondentName": "Marta Gómez", "answers": { "3f9a0c1b2d4e": "HR", "c0ffee00": ["Mail", "Chat"] } }
```

`respondentName` is trimmed; empty means anonymous. It is optional unless the survey's `requireName` is `true`. Each answer is a string, or a list of strings for
`checkbox`. Unknown question ids are ignored. Yes/no answers must be exactly `yes` or `no`.
A `scale` answer is a whole number from the question's `min` to `max`, sent as a number (`4`) or a string (`"4"`);
leave it out or send `""` when the person did not move the slider (allowed only when the question is not required).

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
| `invalid_scale_value` | `min`, `max` | `scale` is not a whole number from `min` to `max` |
| `respondent_name_required` (key `respondentName`) | | The survey's `requireName` is `true` and the name is missing, empty or only spaces |
| `respondent_name_too_long` (key `respondentName`) | `max` | Name over `limits.respondentName` |

`answers` that is not an object answers `422` with `errors: [{ "code": "answers_invalid" }]`.

```json
422
{ "error": { "code": "validation_failed", "message": "Some values are not valid.", "fields": {
  "3f9a0c1b2d4e": { "code": "required", "params": {}, "message": "This field is required." },
  "respondentName": { "code": "respondent_name_too_long", "params": { "max": 100 }, "message": "Name must be at most 100 characters." }
} } }
```

A survey with `requireName: true` and no name:

```json
422
{ "error": { "code": "validation_failed", "message": "Some values are not valid.", "fields": {
  "respondentName": { "code": "respondent_name_required", "params": {}, "message": "Name is required." }
} } }
```

The server is the source of truth: clients may check the same rules first, but the server checks everything again.

---

## 9. Public results

A creator can make a survey's results public: `PATCH /surveys/:id` with `{ "publicResults": true }` returns
a `resultsUrl` (`<web base>/r/<resultsToken>`). Anyone with that link sees the same results as the creator,
**including every answer and respondent names**, without an account. Results are private by default.
`{ "publicResults": false }` deletes the token, so the old link answers 404 for good; turning it on again
makes a new link. These endpoints are read-only: no other method exists under `/public/results/`.

A private, revoked or unknown token answers:

```json
404 { "error": { "code": "not_found", "message": "These results are not public." } }
```

### `GET /public/results/:token`

What a results page shows about the survey. Never the answer token, `shareUrl` or anything about the owner.

```json
200
{ "survey": {
  "title": "Team lunch", "description": "Internal", "closesOn": "2026-11-27", "status": "open", "requireName": false,
  "fields": [ { "id": "3f9a0c1b2d4e", "label": "Department", "type": "radio", "required": true, "options": ["IT", "HR"] } ]
} }
```

### `GET /public/results/:token/summary`

Same body as [`GET /surveys/:id/summary`](#get-surveysidsummary).

### `GET /public/results/:token/responses`

Same body as [`GET /surveys/:id/responses`](#get-surveysidresponses), names included.

```json
200 { "responses": [ { "id": 12, "number": 3, "submittedAt": "2026-11-17T10:05:00Z", "respondentName": "Ana", "answers": { "3f9a0c1b2d4e": "IT" } } ] }
```

### `GET /public/results/:token/events`

The same Server-Sent Events as `GET /surveys/:id/events` (see [Live updates](#7-live-updates)), without a token:
`change` fires on new answers, edits, opening/closing, deleted responses, and when the creator makes the results
private (re-fetching then answers 404).

---

## 10. Admin panel

One **master password** per instance opens the admin panel (the web client's `/..command/` page), which manages every
user and every survey. It is stored hashed in the single row of the `admin` table (`id` is always `1`).

- **Creating it:** `POST /admin/setup` works only while no master password exists. The first request wins; every later
  one is `409 admin_exists`. On a public instance, create it before anyone else finds the page.
- **Replacing or recovering it:** there is no endpoint for that, on purpose. Delete the row in the database
  (`DELETE FROM admin;`), and the next setup creates a new one. Every admin token made before ends at once.
- **Admin tokens** are separate from creator tokens: an admin token never opens creator endpoints (`/surveys`,
  `/me`...), and a creator token never opens `/admin/*`. They last 8 hours. Without a valid admin token, every
  endpoint below except status, setup, login and logout answers `401 unauthorized`.

### `GET /admin/status`

`200 { "configured": false, "fun": false }`. `configured` is `false` while no master password exists (the web page then offers to create it), `true` after. `fun` mirrors the `FUN` setting (see [Configuration](#11-configuration)): the web client's admin login then shows a playful line instead of the plain one.

### `POST /admin/setup`

Body `{ "password": "...", "confirm"?: "..." }` → `201 { "token": "<admin token>" }`.

| Code | When |
|------|------|
| `admin_exists` (409) | A master password already exists (also the losers of simultaneous setups) |
| `admin_password_length` (422, field `password`) | Not 12 to 200 characters |
| `password_mismatch` (422, field `confirm`) | `confirm` sent and different |

### `POST /admin/login`

Body `{ "password": "..." }` → `200 { "token": "<admin token>" }`. Wrong password: `401 invalid_credentials`; no
master password yet: `409 admin_not_configured`. After `LOGIN_MAX_FAILURES` failures from one IP within 15 minutes:
`429 too_many_login_attempts` with `Retry-After`.

### `POST /admin/logout`

Ends the admin token sent, if any. Always `204`.

### `GET /admin/users`

`200 { "users": [{ "id", "name", "email", "createdAt", "surveyCount" }] }`, newest first.

### `PATCH /admin/users/:id`

Body `{ "name"?: "...", "email"?: "..." }`: a field left out keeps its value → `200 { "user": { "id", "name", "email",
"createdAt", "surveyCount" } }`. Same rules as `POST /auth/register` (trimmed): `422` with `fields.name` `name_invalid`
(not 1 to 100 characters), `fields.email` `email_invalid` or `email_taken` (another account uses it, ignoring case).
Nothing changes when something is invalid. The user's sessions stay open; they log in with the new email.

### `PUT /admin/users/:id/password`

Body `{ "password": "..." }` (8 to 200 characters, like registration; else `422` with `fields.password`
`password_length`) → `204`. Every session of that user ends.

### `DELETE /admin/users/:id`

Deletes the user with all their surveys and answers, and ends their sessions → `204`. Unknown user: `404 not_found`.

### `GET /admin/users/:id/surveys`

`200 { "surveys": [...] }`: the user's surveys as in `GET /surveys` (without `fields`), plus `ownerId`.

### `GET`, `PUT`, `PATCH`, `DELETE /admin/surveys/:id`

Any survey, whoever owns it, with the same bodies, rules and answers as the owner's `GET`, `PUT`, `PATCH` and `DELETE
/surveys/:id`; survey objects also carry `ownerId`. The owner's open pages refresh (live updates) after a change.

---

## 11. Configuration

Environment variables of the API process:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port. |
| `HOST` | `127.0.0.1` | Interface to bind. The default makes the API reachable only through the `web/` proxy. To expose it to other clients, set `HOST=0.0.0.0` (then `TRUST_PROXY` defaults to `false`). |
| `DB_PATH` | `data/surveys.db` | SQLite file. Relative paths are resolved from the **repository root**, not the current folder. |
| `WEB_BASE_URL` | unset | Address of the web client, used for `shareUrl` and QR codes. Unset: the address the browser used, as the `web/` proxy reports it in `X-Forwarded-Host` (only with `TRUST_PROXY`), else `http://localhost:3000`. Set it to pin one address (e.g. `http://192.168.1.20:3000`). Falls back to `BASE_URL` when only that is set (setting of the single-server version). |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed to call the API; `*` allows any. |
| `ALLOW_REGISTRATION` | `true` | `false` disables `POST /auth/register` (create accounts with `npm run create-user -- <email> <name> <password>`). |
| `TRUST_PROXY` | `true` when `HOST` is loopback (`127.0.0.1`, `::1`, `localhost`), else `false` | `true` only behind a reverse proxy you control: the client IP comes from `X-Forwarded-For`. The `web/` server is such a proxy (it always overwrites that header); without it every person would count as `127.0.0.1` for the rate limits. An explicit value always wins; the API warns at start-up when it is `true` on a non-loopback host. |
| `LOGIN_MAX_FAILURES` | `10` | Failed logins per email + IP every 15 minutes before `429`. |
| `SUBMISSION_LIMIT` | `60` | Responses per survey + IP every 10 minutes (`0` disables). |
| `FUN` | unset | `true`, `1`, `yes` or `on` (any case): `GET /admin/status` answers `fun: true`, and the web client's admin login shows a playful line. Anything else is off. |

The database schema only grows (additive migrations run on every start), so databases from earlier versions keep all their data.

---

## 12. Error code reference

| Code | Status | Message (English) |
|------|--------|-------------------|
| `unauthorized` | 401 | Log in to continue. |
| `not_found` | 404 | Not found. / Survey not found. / User not found. / This survey does not exist. Check the link you received. / These results are not public. |
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
| `admin_exists` | 409 | The master password already exists. To replace it, delete it in the database. |
| `admin_not_configured` | 409 | The master password has not been created yet. |
| `admin_password_length` | 422 | The master password must be between 12 and 200 characters. (in `fields.password`) |
| `survey_closed` | 403 | This survey is closed and no longer accepts answers. |
| `survey_expired` | 403 | This survey closed on {date} and no longer accepts answers. |
| `already_answered` | 409 | You already answered this survey from this device. Thank you! |
| `too_many_responses` | 429 | Too many responses from this device. Try again in {minutes} minute(s). |
| `internal_error` | 500 | Something went wrong. Please try again. |

Validation codes (inside `fields` / `errors`): `name_invalid`, `email_invalid`, `password_length`,
`password_mismatch`, `email_taken`, `title_required`, `title_too_long`, `description_too_long`,
`closing_date_invalid`, `closing_date_past`, `require_name_invalid`, `fields_invalid`, `fields_empty`, `fields_too_many`,
`field_invalid`, `label_required`, `label_too_long`, `type_unknown`, `options_empty`, `options_too_many`,
`option_too_long`, `option_duplicate`, `scale_bound_invalid`, `scale_order`, `scale_too_wide`,
`label_duplicate`, `is_open_invalid`, `public_results_invalid`, `answers_invalid`, `respondent_name_required`, `respondent_name_too_long`, `required`, `invalid_option`,
`too_long`, `invalid_number`, `invalid_email`, `invalid_date`, `invalid_scale_value`. Their English texts live in `api/locales/en.json`; the key-to-code table is `api/src/errors.js`.
