FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY services/sync/package.json services/sync/package.json
RUN pnpm install --frozen-lockfile
COPY services/sync services/sync
RUN pnpm --filter @locus/sync-service build

FROM node:24-alpine
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app/services/sync/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/sync/package.json ./package.json
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "dist/server.js"]
