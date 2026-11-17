# Sharevy web client

The browser app of Sharevy. Plain JavaScript ES modules with no framework and no build step. It talks to the REST API (`../api`, contract in `../docs/API.md`) only through JSON.

```
npm start   # PORT=3000, HOST=0.0.0.0, API_URL=http://127.0.0.1:3001
npm test    # web server + pure modules (node:test)
```

## How it is served

`server.js` (no dependencies) does three things:

- `/api/*` is forwarded to `API_URL`, including event streams, status codes and headers. The browser therefore uses one origin and needs no CORS. The proxy sets `X-Forwarded-For` to the address it really sees. The API's defaults (`HOST=127.0.0.1`, which turns `TRUST_PROXY` on) keep it unexposed and make its rate limits count each person rather than the proxy.
- `/public/*` and `/locales/*` serve files from `public/` and `locales/`.
- App pages (`/`, `/login`, `/surveys/...`, `/s/<token>`, ...) answer `index.html`, and the client router (`public/js/routes.js`) draws the page. Unknown paths answer `index.html` with status 404.

Every file is sent with `Cache-Control: no-cache` and an `ETag`. Module URLs never change without a build step, so the browser revalidates them (a cheap 304) and never runs stale code. Fonts are cached as immutable. Every page gets a strict CSP: only this origin's scripts and styles, nothing inline.

## Code map (`public/js/`)

| Path | Role |
|------|------|
| `main.js`, `app.js` | Start-up, session, language, theme, router, live regions |
| `routes.js` | Path -> page |
| `pages/` | Containers: fetch data, handle actions, return DOM |
| `components/` | Presentational: pure functions from data to DOM (same classes as before, so `style.css` applies) |
| `api.js`, `errors.js` | Fetch wrapper (Bearer token, `X-Device-Id`) and API error code -> message key |
| `storage.js`, `dom.js` | Saved values (token, device id, language, theme) and safe DOM builders (`h()`, `s()`, no `innerHTML`) |
| `i18n.js`, `format.js`, `validation.js`, `number-input.js`, `charts.js`, `sse.js` | Pure logic, tested in `test/modules.test.js` |

## Tradeoffs

- **Token in `localStorage`** (`sharevy-token`). Any script on this origin could read it. This risk is kept small: the CSP allows only this origin's scripts, the page loads no third-party code, and the DOM is built without `innerHTML`. Tokens expire after 7 days, and "Log out" ends the token on the server.
- **The respondent form needs JavaScript.** The single-server version also worked without it.
- **Device id** (`sharevy-device`): 32 random bytes, made once per browser and sent as `X-Device-Id`. Clearing site data counts as a new device.
