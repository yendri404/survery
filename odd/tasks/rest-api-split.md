# Feature: REST API + separate web client (rest-api-split)

Objective: split Sharevy into a JSON REST API (`api/`) and an independent web client (`web/`) that talk only through JSON, so other clients (e.g. mobile) can be built later.
Branch: `feat/rest-api-split` (from `main` @ 6287769). Delivery: work-unit commits on the branch; merge to `main` is the user's decision. Test runner: `node --test` (node:test), browser checks via Chrome DevTools Protocol.

## Specs

- **S1 — Split into two entities.** User: "cambio de planes, hay que restructurar todo y hacerlo funcionar como una API rest, teniendo completamente separado el backend del frontend, esta en tus manos convertirlo en dos entidades separadas y que se comuniquen por JSON ya que se espera que en el futuro se pueda crear clientes diferentes". Backend in `api/` (own package.json, own server, JSON only, no HTML). Frontend in `web/` (own static server, no server-side rendering of app data). They communicate only via HTTP + JSON.
- **S2 — Frontend technology.** User choice (2026-11-17): "JavaScript puro, sin build". No frameworks, no bundler/compile step; ES modules served as static files.
- **S3 — API contract for any client.** Versioned base path `/api/v1`. Bearer token auth (`Authorization: Bearer <token>`), tokens stored hashed server-side. JSON errors with stable machine codes and params (`{ "error": { "code", "message", "fields"? } }`); clients translate codes. CORS for configured web origin(s). Documented in `docs/API.md` with request/response examples.
- **S4 — Behavior parity.** Everything that works today keeps working: creator accounts (register/login/logout, rate limiting, optional registration), surveys CRUD with all question types (text, textarea, number, email, date, select, radio, checkbox, yesno), duplicate option/question rejection, closing date (10-day default, expiry), open/close, delete, responses list/delete, CSV export (comma/semicolon, BOM, formula neutralization), QR code of the share link, KPIs and chart data, live updates (SSE), one response per device, optional respondent name, respondent validation (client and server), number input filtering, EN/ES i18n with language menu, light/dark theme, desktop layout, animations, corporate branding, logo. Existing data in `data/surveys.db` keeps working (no data loss; migrations additive).
- **S5 — Preserve user's local style edit.** Uncommitted user change in `public/style.css`: `.result-icon { ... border-radius: 100px; ... }` (circular result icon) must be kept in the web client.
- **S6 — Operations.** Desktop control script (`C:\Users\smanzano\Desktop\Sharevy server.bat`) starts/stops/restarts/statuses both processes. Docs (README, CODE_GUIDE, docs/API.md) describe the new structure.

Assumptions (not user-stated, chosen by the parent; revisit if the user objects): API on port 3001, web on port 3000 (users keep the same URL); SSE consumed with `fetch` streaming so the token travels in a header (never in the URL); device identity for "one response per device" becomes a client-generated id sent in an `X-Device-Id` header; UI strings move to `web/locales/`, API returns codes plus English `message`.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S3, S4 (backend), S6 docs for API | delegated (context backstop) | done — 65/65 api tests, old-vs-new differential identical | e241b59, 22e37fb, d294043, b0d9e58 |
| T2 | S1, S2, S4 (frontend), S5 | delegated (context backstop; depends on T1 contract) | done — api 65/65, web 30/30, 36 Chrome e2e checks, screenshots equivalent to main | c16db4e, 055e0b2, d31f498 |
| T3a | S6 desktop script (both layouts, both processes) | inline | done — legacy status on live server; split start/status/restart/stop on ports 3100/3101, LAN via proxy OK, API not reachable from LAN | outside repo (Desktop) |
| T3b | S6 README + CODE_GUIDE for the split | delegated (context backstop) | done — api 65/65, web 30/30 after docs | a541f70 |

Route evidence: parent context is past the ~150k backstop; T1 and T2 are sequential (T2 consumes the T1 contract), so one bounded writer each.

## Log

- L1 (2026-11-17, user, verbatim): "cambio de planes, hay que restructurar todo y hacerlo funcionar como una API rest, teniendo completamente separado el backend del frontend, esta en tus manos convertirlo en dos entidades separadas y que se comuniquen por JSON ya que se espera que en el futuro se pueda crear clientes diferentes"
- L2 (2026-11-17): user chose frontend technology "JavaScript puro, sin build" (options offered: React + Vite, plain JS, Vue + Vite).
- L3 (2026-11-17): found an uncommitted user edit in `public/style.css` (circular `.result-icon`); recorded as S5.
- L4: next step — launch T1 writer.
- L5 (2026-11-17): T1 done. API in `api/` under `/api/v1` (contract in `docs/API.md`): Bearer auth on the sessions table, error codes in `api/src/errors.js` (survey errors as ordered `errors[]`; registration/answer errors in `fields{}`), `/meta`, `/summary`, CSV `?delimiter&lang`, QR svg/png, SSE with Bearer header, `X-Device-Id` (missing header → server-generated id returned as `deviceId`; malformed → 400 `invalid_device_id`), ISO UTC timestamps. API keeps only `api/locales` (English messages, CSV headers, Sí/No). Root `locales/` and `public/` untouched for T2.
- L6 (2026-11-17): the user's desktop script runs `survey-app` from the working tree, so development moved to a git worktree `../sharevy-split` (branch `feat/rest-api-split`); `survey-app` stays on `main` (stable, live server) with the user's uncommitted `public/style.css` edit. Decision for T2: the web server (port 3000) serves static files AND proxies `/api/*` to the API (`API_URL`, default `http://127.0.0.1:3001`), so the browser talks to a single origin (no CORS needed for the web client, LAN links keep working). `WEB_BASE_URL` for share links is set by the desktop script from the detected LAN IP.
- L7: T1 tests leave `sharevy-api-v1-*` temp dirs in the OS temp folder — test hygiene to fix (clean up in `after`). Fixed in c16db4e.
- L8 (2026-11-17): T2 done. `web/` = zero-dep server (static + SPA fallback + `/api` proxy incl. SSE, CSP, ETag) and ES-module client (pages as containers, components as pure DOM builders, no innerHTML). Token in localStorage (tradeoff documented in web/README.md); respondent form now needs JavaScript (accepted). Proxy overwrites `X-Forwarded-For`, so the API must run with `TRUST_PROXY=true` on `HOST=127.0.0.1`.
- L9 (2026-11-17): T3a done. Desktop script `Sharevy server.bat` detects layout (legacy `src/server.js` vs split `api/` + `web/`), starts API on 127.0.0.1:3001 (TRUST_PROXY, WEB_BASE_URL and CORS_ORIGINS from detected LAN IP) and web on 0.0.0.0:3000 (API_URL), stops both with a node-only safety check; overrides SHAREVY_DIR / SHAREVY_WEB_PORT / SHAREVY_API_PORT. Next: T3b docs, then the user decides the merge of `feat/rest-api-split` into `main`.
- L10 (2026-11-17): T3b done (README + CODE_GUIDE rewritten; docs/API.md and web/README.md factual fixes). Note: API `HOST` defaults to `0.0.0.0` in code; only the desktop script binds it to 127.0.0.1. All tasks done. Pending user decisions: (1) independent security review before merge (Risk items 2, 3, 5); (2) merge `feat/rest-api-split` into `main` (the user's uncommitted `public/style.css` edit on main becomes obsolete — S5 already applied in `web/`).
