FROM node:22-bookworm-slim AS base

WORKDIR /backend

COPY package*.json ./
COPY prisma ./prisma/

FROM base AS development
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 8000
CMD ["npm", "run", "start:dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /backend
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /backend/dist ./dist
EXPOSE 8000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
