import { closeServer, createWebServer } from './server/app.js';

// Web client of Sharevy. PORT/HOST: where people open the app; API_URL: where the REST API runs.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3001';
// Public address of the app, for the absolute URLs of link previews (the same setting the API uses
// for share links). Unset: the address each visitor used.
const baseUrl = process.env.WEB_BASE_URL || process.env.BASE_URL || undefined;

const server = createWebServer({ apiUrl, baseUrl });
server.listen(port, host, () => {
  console.log(`Sharevy web listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (API: ${apiUrl})`);
});

const stop = () => closeServer(server).then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
