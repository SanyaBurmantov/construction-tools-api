FROM node:22-bookworm-slim AS base

WORKDIR /backend

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

FROM base AS development
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 8000
# Mirrors the production stage: apply migrations before starting, so a database
# volume that outlived earlier code doesn't leave the schema behind.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm test -- --runInBand --silent
RUN npm run build

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /backend
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /backend/dist ./dist
EXPOSE 8000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
