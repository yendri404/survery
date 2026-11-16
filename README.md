# Sharevy

Self-hosted web app to create surveys and collect responses through a shareable link.

- **Creators** have accounts (email + password) and manage their own surveys.
- **Respondents** answer anonymously through the link — no account, no cookies, no JavaScript required.
- **One small dependency** ([`qrcode`](https://www.npmjs.com/package/qrcode), pinned) plus Node.js and its built-in SQLite. After `npm install`, it works fully offline inside a private network.

## Requirements

- Node.js **22.13+** (uses the built-in `node:sqlite` module).

## Run

```bash
npm install   # once, needs internet (or copy node_modules from another machine)
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
| `TRUST_PROXY`        | `false`            | Set to `true` only behind a reverse proxy you control, to read the client IP from `X-Forwarded-For`. |
| `LOGIN_MAX_FAILURES` | `10`               | Failed logins allowed per email + IP every 15 minutes before answering 429. |
| `SUBMISSION_LIMIT`   | `60`               | Responses accepted per survey + IP every 10 minutes (`0` disables). Raise it if many people answer from one shared PC. |

When registration is disabled, create creator accounts from the command line:

```bash
npm run create-user -- <email> <name> <password>
```

## Features

- Question types: short text, long text, number, email, date, dropdown, single choice, multiple choice. Each can be required.
- Respondents can optionally leave their name; otherwise the response is anonymous.
- One response per device and survey (device cookie; clearing cookies or another browser counts as a new device).
- Edit questions at any time; existing answers are kept.
- Every survey has a closing date (picked with a calendar; 10 days from creation by default). It accepts answers until the end of that day, server time.
- Open/close a survey manually at any time.
- Results update live while you watch: new answers appear without reloading the page.
- Results page with key figures (responses, named vs anonymous, last response, days left), charts for choice questions (a donut for single choice, bars for multiple choice), the full results table, and deleting individual responses.
- Phone-first layout; on wide screens (1100px and up) pages use two columns: results next to a sticky share panel, questions next to the survey settings.
- Light and dark theme (follows the device setting until changed with the theme button).
- Corporate look: IBM Plex Sans, square corners and a muted slate palette, with WCAG AA text contrast in both themes.
- Short, sober animations (page fades, a light entrance for cards and charts, a check mark that draws itself after answering); turned off when the device asks for reduced motion.
- English and Spanish interface, chosen from the language menu next to the theme button (see [Languages](#languages)).
- QR code of the share link on every survey, downloadable as PNG to print or send.
- CSV export (comma, or semicolon for Excel with regional settings that use `;`). UTF-8 with BOM.

## Languages

The interface is available in **English** and **Spanish**, on creator and respondent pages.

| Who decides | How |
|-------------|-----|
| 1. The visitor's choice | The language menu (globe icon + current code) next to the theme button. It lists every language by its own name, works without JavaScript and is remembered for a year in a `sharevy_lang` cookie. |
| 2. The browser | Otherwise, the first supported language in the browser's `Accept-Language` setting (`es-MX`, `es-ES`… all count as Spanish). |
| 3. Default | English. |

Surveys themselves (titles, questions, options) are shown exactly as their creator wrote them. CSV exports use the creator's current language for the fixed column headers.

Translations live in `locales/en.json` and `locales/es.json`. To add a language, see "How to add a language" in [CODE_GUIDE.md](CODE_GUIDE.md#i18njs--interface-languages).

## Font and license

The interface uses **IBM Plex Sans** (weights 400, 500, 600; latin subset, which covers English and Spanish), served from `public/fonts/`. No request leaves the server, so it works offline in a private network.

| Item | Detail |
|------|--------|
| Source | [`@fontsource/ibm-plex-sans`](https://www.npmjs.com/package/@fontsource/ibm-plex-sans) 5.3.0, files copied in (not an npm dependency) |
| License | SIL Open Font License 1.1, see [`public/fonts/LICENSE-IBM-Plex.txt`](public/fonts/LICENSE-IBM-Plex.txt) |
| Fallback | `"Segoe UI", system-ui, sans-serif` while the font loads (`font-display: swap`) |

## Security notes

- Passwords hashed with scrypt; sessions in HttpOnly, SameSite=Lax cookies (stored hashed in the database); CSRF tokens on every creator form.
- Login attempts and anonymous submissions are rate limited in memory (counters reset on restart).
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
  i18n.js          interface languages: choosing one, translating, dates
locales/           en.json, es.json (all interface text)
public/            builder.js (question editor), app.js, style.css, logo.png, favicon.svg
  fonts/           IBM Plex Sans (woff2, latin subset) + its license
assets/           logo-source.png (full-size original of the header logo)
scripts/           create-user.js
test/              node:test suites
```

## Code guide

See [CODE_GUIDE.md](CODE_GUIDE.md) for a file-by-file explanation of `src/`.
