# syntax=docker/dockerfile:1
# Build context: repository root.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @mrak/online-api...
RUN pnpm --filter @mrak/online-api build
RUN pnpm --filter @mrak/online-api deploy --prod /out

FROM node:24-alpine AS runtime
# Minimal runtime: patched OS packages, no package managers (smaller attack surface; Trivy gate).
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/services/online-api/dist ./dist
COPY --from=build --chown=node:node /repo/packages/content/data/achievements ./content/achievements
COPY --from=build --chown=node:node /repo/packages/content/data/bloodline-nodes ./content/bloodline-nodes
ENV CONTENT_DATA_DIR=/app/content
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
