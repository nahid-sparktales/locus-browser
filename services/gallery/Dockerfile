FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/extensions/package.json packages/extensions/package.json
COPY services/gallery/package.json services/gallery/package.json
RUN pnpm install --frozen-lockfile
COPY packages/extensions packages/extensions
COPY services/gallery services/gallery
RUN pnpm --filter @locus/extensions build \
  && pnpm --filter @locus/extension-gallery-service build \
  && pnpm --filter @locus/extension-gallery-service deploy --prod --legacy /out

FROM node:24-alpine
USER node
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production PORT=8790 LOCUS_GALLERY_PACKAGES=/packages
EXPOSE 8790
CMD ["node", "dist/server.js"]
