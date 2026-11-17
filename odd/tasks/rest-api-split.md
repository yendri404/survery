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
| T1 | S1, S3, S4 (backend), S6 docs for API | delegated (context backstop) | pending | — |
| T2 | S1, S2, S4 (frontend), S5 | delegated (context backstop; depends on T1 contract) | pending | — |
| T3 | S6 (desktop script, README/CODE_GUIDE), end-to-end verification | inline | pending | — |

Route evidence: parent context is past the ~150k backstop; T1 and T2 are sequential (T2 consumes the T1 contract), so one bounded writer each.

## Log

- L1 (2026-11-17, user, verbatim): "cambio de planes, hay que restructurar todo y hacerlo funcionar como una API rest, teniendo completamente separado el backend del frontend, esta en tus manos convertirlo en dos entidades separadas y que se comuniquen por JSON ya que se espera que en el futuro se pueda crear clientes diferentes"
- L2 (2026-11-17): user chose frontend technology "JavaScript puro, sin build" (options offered: React + Vite, plain JS, Vue + Vite).
- L3 (2026-11-17): found an uncommitted user edit in `public/style.css` (circular `.result-icon`); recorded as S5.
- L4: next step — launch T1 writer.
