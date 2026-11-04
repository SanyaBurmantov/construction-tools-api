FROM node:22-bookworm-slim AS base

WORKDIR /backend

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Only the lockfile before `npm ci`: `prisma/` changes with every migration,
# and copied here it invalidated the dependency layer — a release with a
# migration reinstalled every package twice (build + production), ~2 min.
COPY package*.json ./

FROM base AS development
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 8000
# Mirrors the production stage: apply migrations before starting, so a database
# volume that outlived earlier code doesn't leave the schema behind.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]

FROM base AS build
# CI passes false: its backend job has already run the tests on this commit.
ARG RUN_TESTS=true
RUN npm ci
COPY . .
RUN npx prisma generate
RUN if [ "$RUN_TESTS" = "true" ]; then npm test -- --runInBand --silent; fi
RUN npm run build

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /backend
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
# The schema after the dependencies, for the same reason as in `base`.
COPY prisma ./prisma/
RUN npx prisma generate
COPY --from=build /backend/dist ./dist
# Fonts for the PDF invoice and quote (src/documents/).
COPY --from=build /backend/assets ./assets
# Not root: a compromised process should not own the container.
RUN chown -R node:node /backend
USER node
EXPOSE 8000
# `exec` makes node PID 1. Without it `sh` is PID 1 and does not forward
# SIGTERM, so enableShutdownHooks() never ran and every deploy hard-killed
# in-flight parser and AI writes after the 10 s grace period.
# MIGRATE_ON_BOOT=false when the app runs as a role without DDL rights
# (docker-compose.prod.yml sets it with DB_APP_USER): auto-deploy.sh has
# applied the migrations as the owner before this container started.
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_BOOT\" != false ]; then npx prisma migrate deploy; fi && exec node dist/main"]
