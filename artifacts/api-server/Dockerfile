# Multi-stage build for the api-server.
# Build context MUST be the repo root (run `fly deploy` from /app, or use docker build /app -f artifacts/api-server/Dockerfile).

FROM node:20-alpine AS build
WORKDIR /app

# Workspace metadata + lockfile first for better layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
# Shared libs referenced via workspace:* protocol
COPY lib ./lib
# The api-server itself
COPY artifacts/api-server ./artifacts/api-server

RUN corepack enable && corepack prepare pnpm@9 --activate
RUN pnpm install --frozen-lockfile --filter @workspace/api-server...
RUN pnpm --filter @workspace/api-server run build

# ---- Runtime image ----
FROM node:20-alpine
WORKDIR /app
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build /app/artifacts/api-server/dist /app/dist

ENV NODE_ENV=production
ENV PORT=8080
ENV PUSH_STORE_PATH=/data/push-store.json

USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "/app/dist/index.mjs"]
