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
COPY --from=build /frontend/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
