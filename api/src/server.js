import { createApp } from './app.js';
import { isLoopback, loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const server = createApp({ db, config });

server.listen(config.port, config.host, () => {
  console.log(`Sharevy API listening on http://${config.host}:${config.port}/api/v1 (database: ${config.dbPath}, web client: ${config.webBaseUrl})`);
  // With TRUST_PROXY the API believes X-Forwarded-For. If it is also reachable from the network,
  // a client can fake that header and dodge the per-IP rate limits.
  if (config.trustProxy && !isLoopback(config.host)) {
    console.warn('WARNING: TRUST_PROXY=true while listening on a non-loopback host. Set HOST=127.0.0.1 so only the web proxy can reach the API.');
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
