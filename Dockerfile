# Sharevy: one image for both processes (the REST API and the web client). compose.yml runs it
# twice with a different command; the API is never published, only the web port.
#
# Base: node:26.13.1-alpine, the smallest official Node image (about 63 MB compressed) and the
# exact Node version the test suites run on. Node >= 22.13 is required (node:sqlite).

# ---------- Dependencies: install the API's production packages (qrcode, pure JavaScript) ----------
FROM node:26.13.1-alpine AS deps
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Runtime ----------
FROM node:26.13.1-alpine
# npm, npx, yarn and corepack are not needed to run the app: dropping them makes the image smaller
# and leaves fewer tools inside the container.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    DB_PATH=/data/surveys.db
WORKDIR /app

COPY --from=deps /app/api/node_modules api/node_modules
COPY api/package.json api/
COPY api/src api/src
COPY api/locales api/locales
COPY api/scripts api/scripts
COPY web/package.json web/server.js web/index.html web/
COPY web/server web/server
COPY web/public web/public
COPY web/locales web/locales

# The database lives in /data (a volume), never inside the image.
VOLUME /data
USER node
EXPOSE 3000 3001

# Default: the API. compose.yml starts the web client with `node web/server.js`.
CMD ["node", "api/src/server.js"]
