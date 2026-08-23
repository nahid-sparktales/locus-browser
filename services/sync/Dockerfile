FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/sync-crypto/package.json packages/sync-crypto/package.json
COPY services/sync/package.json services/sync/package.json
RUN pnpm install --frozen-lockfile
COPY packages/sync-crypto packages/sync-crypto
COPY services/sync services/sync
RUN pnpm --filter @locus/sync-crypto build \
  && pnpm --filter @locus/sync-service build \
  && pnpm --filter @locus/sync-service deploy --prod --legacy /out

FROM node:24-alpine
USER node
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "dist/server.js"]
