FROM node:22-bookworm-slim AS base

WORKDIR /frontend

COPY package*.json ./

FROM base AS development
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
ARG NUXT_PUBLIC_API_BASE=/api
ENV NUXT_PUBLIC_API_BASE=${NUXT_PUBLIC_API_BASE}
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /frontend
COPY --from=build --chown=node:node /frontend/.output ./.output
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint
EXPOSE 3000
# Starts as root only to hand the page-cache volume over, then drops to
# `node` for good (docker-entrypoint.sh). `exec` keeps node as PID 1.
CMD ["docker-entrypoint"]
