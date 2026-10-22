# syntax=docker/dockerfile:1
FROM node:22.23.4-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY tests ./tests
COPY public ./public
COPY database/schema.sql ./database/schema.sql
COPY scripts/copy-schema.mjs ./scripts/copy-schema.mjs
COPY scripts/pwa.ts ./scripts/pwa.ts
COPY pwa ./pwa
RUN npm run build

FROM node:22.23.4-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node LICENSE NOTICE ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/build ./build
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "build/server/index.js", "--production", "--host", "0.0.0.0"]
