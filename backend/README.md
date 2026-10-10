# Backend Developer Notes

NestJS API for the construction tools catalog. This document is written for future developers and coding agents working inside `backend/`.

## Stack

- NestJS 11.
- Prisma 5.
- PostgreSQL.
- Cheerio + native `fetch` for supplier parsers.
- `@nestjs/schedule` for cron jobs.
- Swagger is enabled outside production or when `SWAGGER_ENABLED=true`.

## Commands

Run from `backend/`:

```bash
npm install
npm run build
npm run lint
npm test
npx prisma generate
npx prisma migrate deploy
```

Local database is usually started from repository root:

```bash
docker compose up -d db
```

Use Node `22.12.0+`. The repo has `.nvmrc` files and package engine constraints.

## Environment

Important env vars:

- `DATABASE_URL`: PostgreSQL connection string.
- `PORT`: defaults to `8000`.
- `ADMIN_TOKEN`: the service-to-service key for `/admin/*` through
  `x-admin-token` (runbook curl, CI). Humans sign in with an ADMIN account
  instead — see `AuthModule`.
- `ADMIN_LOGIN` / `ADMIN_PASSWORD`: the initial admin account, created on boot
  only when no active ADMIN exists. Defaults: login `admin`, password
  `test-111` (committed in `auth/admin-bootstrap.service.ts`) — change it in
  `/admin/users` after the first sign-in, or set `ADMIN_PASSWORD` to start
  from your own.
- `AUTH_SESSION_TTL_DAYS`: account session lifetime, default `30`.
- `CART_TTL_DAYS`: how long an untouched account cart is kept, default `90`.
- `LIST_TTL_DAYS`: same for favourites/comparison, default `365`.
- `ADMIN_LOG_TTL_DAYS`: how long the admin action log is kept, default `180`.
- `PARSER_CRON_ENABLED`: set `true` to enable parser cron jobs.
- `DUKON_CRON_BATCH_LIMIT`: default `30`.
- `TH_TOOLS_CRON_BATCH_LIMIT`: default `30`.
- `DUKON_DISCOVERY_MAX_PAGES`: default `5000`.
- `SWAGGER_ENABLED`: enables Swagger in production when `true`.

If supplier requests fail through a proxy, bypass supplier domains, for example `NO_PROXY=dukon.by,www.dukon.by`.

## Main Modules

- `ProductsModule`: public product list/detail API.
- `CategoriesModule`: public category API.
- `BrandsModule`: public brand API.
- `SourcesModule`: public supplier list (`GET /sources`) — id, name and code
  only, never the supplier URL.
- `ParserModule`: parser services, cron jobs, parser logs.
- `AdminModule`: guarded admin API, including `/admin/users`.
- `AuthModule`: accounts and sessions (`/auth/*`), `AuthGuard`, and the
  bootstrap that creates the first admin.
- `AccountModule`: the customer's личный кабинет (`/account/*`).
- `CartModule`: cart re-pricing (`POST /cart/validate`, public) and the
  account's stored cart (`GET/PUT/DELETE /cart`, `POST /cart/merge`).
- `ListsModule`: the account's favourites and comparison (`/lists`).
- `AuditModule`: the admin action log (`/admin/audit`) and the interceptor that
  fills it.
- `PrismaModule`: global Prisma client.

## Product Visibility Rule

Supplier-parsed products are storefront-visible by default.

- New Dukon and th-tools products are created as `PUBLISHED`.
- Existing supplier products in `DRAFT` are promoted to `PUBLISHED` during parser batch runs.
- `HIDDEN` and `ARCHIVED` are treated as manual admin decisions and must not be overwritten by parser code.

Public `/products` returns only `PUBLISHED` products.

## Supplier Data Model

Important models in `prisma/schema.prisma`:

- `Product`: normalized catalog product shown on the site.
- `Source`: supplier identity, for example `dukon` or `th-tools`.
- `SourceProduct`: supplier snapshot linked to a normalized `Product`.
- `SourceCategory`: supplier category tree and optional mapping to internal `Category`.
- `SitemapsDukon`: Dukon queue with `PENDING`, `DONE`, `FAILED`, `SKIPPED`.
- `SitemapsThTools`: th-tools queue with `isVisited`.
- `ParserError`: persisted parser errors for admin UI.
- `ParserRuntimeStatus`: persisted cron runtime status for monitoring.

Source snapshots should preserve supplier-specific data:

- `sku` as a dedicated field.
- `price` and `currency`.
- `images`.
- `description`.
- `specifications` JSON.
- `sourceCategoryId` when known.

Do not store supplier SKU only inside free-form specifications.

## Dukon Parser

Main files:

- `src/parser/sites/dukon.parser.ts`
- `src/parser/sites/dukon.cron.ts`
- `src/parser/sites/dukon.parser.spec.ts`
- `src/parser/sites/fixtures/dukon-product.html`

Current behavior:

- Loads official sitemap and extends it with HTML discovery for priority catalog branches.
- Priority branch is currently `/catalog/nabory-instrumentov/`.
- Persists discovered category tree into `SourceCategory` and internal `Category`.
- Parses product name, SKU, brand, price, description, images, breadcrumbs, specs.
- Creates/updates `Product`, `ProductImage`, `Specification`, `ProductSpecification`, `SourceProduct`.
- Cleans previously stored Dukon template images from `ProductImage` during batch runs.
- Marks non-product pages as `SKIPPED` rather than failed parser errors.

Cron behavior when `PARSER_CRON_ENABLED=true`:

- Every 30 minutes: process `DUKON_CRON_BATCH_LIMIT` pending URLs, concurrency `1`.
- Daily at `06:00`: refresh sitemap/discovery.
- Monthly on day `1` at `12:00`: refresh and revalidate queue.
- Overlap protection prevents the same Dukon cron job from running twice in parallel.

## th-tools Parser

Main files:

- `src/parser/sites/th-tools.parser.ts`
- `src/parser/sites/th-tools.cron.ts`
- `src/parser/sitemaps/sitemaps.service.ts`

Current behavior:

- Loads th-tools sitemap into `SitemapsThTools`.
- Processes `TH_TOOLS_CRON_BATCH_LIMIT` items every 30 minutes when cron is enabled.
- Writes full `SourceProduct` snapshot.
- Uses overlap protection in cron.

## Admin API Highlights

All `/admin/*` endpoints require `x-admin-token`.

Parsing/monitoring endpoints:

- `GET /admin/queue`
- `GET /admin/queue/sitemaps`
- `GET /admin/queue/errors`
- `DELETE /admin/queue/errors`
- `GET /admin/queue/runtime-status`
- `GET /admin/queue/health`
- `GET /admin/queue/supplier-summary`
- `POST /admin/queue/refresh-sitemaps`
- `POST /admin/queue/process`
- `GET /admin/queue/dukon`
- `GET /admin/queue/dukon/sitemaps`
- `POST /admin/queue/dukon/refresh-sitemaps`
- `POST /admin/queue/dukon/process`
- `POST /admin/queue/dukon/sitemaps/:id/retry`
- `POST /admin/queue/dukon/sitemaps/retry-problems`

Public/internal health endpoint:

- `GET /health/parser`: sanitized parser health for uptime monitoring, no admin token.

If this endpoint should not be public, restrict it at reverse proxy or firewall level.

## Public Product API

- `GET /products`
- `GET /products/:slug`

`GET /products` supports:

- `search`
- `categoryId`
- `brandId`
- `sourceCode`, for example `dukon`
- `priceMin`
- `priceMax`
- `sortBy`: `name`, `price`, `createdAt`, `updatedAt`
- `sortOrder`: `asc`, `desc`
- `page`
- `limit`

## Development Rules

- Keep parser changes small and fixture-backed when possible.
- Do not make supplier products `DRAFT` unless product visibility requirements change.
- Do not overwrite `HIDDEN` or `ARCHIVED` products from parser code.
- Prefer adding supplier-specific parser tests before changing selectors.
- Keep migrations committed with schema changes.
- Run `npx prisma generate` after Prisma schema changes.
- Run `npm run build`, `npm run lint`, and relevant tests before handing off.

## Production Checklist

- Apply migrations: production Docker runs `npx prisma migrate deploy` before start.
- Set `PARSER_CRON_ENABLED=true`.
- Keep `DUKON_CRON_BATCH_LIMIT=30` unless crawl pressure needs changing.
- Monitor `GET /health/parser`.
- Check admin parsing page after deploy:
  - cron status;
  - supplier summary;
  - Dukon queue counts;
  - parser errors.
