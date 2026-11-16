# Survey App

Self-hosted web app to create surveys and collect responses through a shareable link.

- **Creators** have accounts (email + password) and manage their own surveys.
- **Respondents** answer anonymously through the link — no account, no cookies, no JavaScript required.
- **Zero external dependencies**: Node.js + its built-in SQLite. Works fully offline inside a private network.

## Requirements

- Node.js **22.13+** (uses the built-in `node:sqlite` module).

## Run

```bash
npm start
```

Open `http://localhost:3000`, register a creator account, and create a survey.
Other people on the same network open the share link shown on the survey page
(e.g. `http://<server-ip>:3000/s/<token>`).

## Configuration (environment variables)

| Variable             | Default            | Description |
|----------------------|--------------------|-------------|
| `PORT`               | `3000`             | HTTP port. |
| `HOST`               | `0.0.0.0`          | Interface to bind (all interfaces, so the LAN can reach it). |
| `DB_PATH`            | `data/surveys.db`  | SQLite database file. Back this file up. |
| `BASE_URL`           | *(request host)*   | Public URL used to build share links, e.g. `https://surveys.intranet.local`. Set it when running behind a reverse proxy. |
| `ALLOW_REGISTRATION` | `true`             | Set to `false` to disable self-registration of creators. |
| `COOKIE_SECURE`      | `false`            | Set to `true` when served over HTTPS. |

When registration is disabled, create creator accounts from the command line:

```bash
npm run create-user -- <email> <name> <password>
```

## Features

- Question types: short text, long text, number, email, date, dropdown, single choice, multiple choice. Each can be required.
- Edit questions at any time; existing answers are kept.
- Open/close a survey to start/stop accepting responses.
- Results table, per-option summary for choice questions, delete individual responses.
- CSV export (comma, or semicolon for Excel with regional settings that use `;`). UTF-8 with BOM.

## Security notes

- Passwords hashed with scrypt; sessions in HttpOnly, SameSite=Lax cookies; CSRF tokens on every creator form.
- Creators can only access their own surveys.
- Share links use 144-bit random tokens; anyone holding the link can answer.
- CSV export neutralizes spreadsheet formula injection.
- Strict Content-Security-Policy (no inline scripts).

## Tests

```bash
npm test
```

## Project structure

```
src/
  server.js        entry point (config, database, HTTP server)
  app.js           router, sessions, static assets, error handling
  routes/          auth (creators), surveys (creator dashboard), public (respondents)
  surveys.js       domain rules: survey definition, answer validation, CSV
  repo.js          SQLite queries
  views.js         server-rendered HTML
public/            builder.js (question editor), app.js, style.css
scripts/           create-user.js
test/              node:test suites
```
