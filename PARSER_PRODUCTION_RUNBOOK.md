# Parser Production Runbook

## Priority Sources

Production focus is `tools.by`, `th-tools`, and `dukon`. `7745.by` remains implemented, but it is secondary and its cron should stay disabled unless explicitly needed.

## Current Safety Rules

- Start parser batches small: `limit=20-50`, `concurrency=1` for first production runs.
- Do not run broad unattended `tools.by` discovery. `tools.by` has restrictive `robots.txt`; use manual URL import/preview unless permission/access changes.
- Prefer dry-run preview before importing real products from a new category or unknown markup variant.
- Watch `FAILED` and `SKIPPED` queue statuses after every batch.
- Do not treat missing price as fatal by default, but never save `NaN`.
- Product name is mandatory. Missing name should fail the URL.

## Database Readiness

`SitemapsThTools` now uses the same production queue fields as other suppliers: `status`, `attempts`, `lastError`, `lastTriedAt`, and `visitedAt`. Legacy `isVisited` remains for compatibility.

Before deploying this code to an existing database, apply the Prisma schema change with the project's chosen migration flow. If no migration files are used in this environment, run a controlled `prisma db push` against staging first, then production.

Recommended verification after DB schema update:

```bash
cd backend
npx prisma generate
npm run build
```

## Admin Endpoints

All endpoints require `x-admin-token`.

Preview a single source product without writing to DB:

```http
POST /admin/source-products/preview
Content-Type: application/json

{ "sourceId": "<source-id>", "url": "https://example/product" }
```

Import a single source product and write normalized `Product` plus `SourceProduct` snapshot:

```http
POST /admin/source-products/import
Content-Type: application/json

{ "sourceId": "<source-id>", "url": "https://example/product" }
```

TH-Tools queue:

```http
GET /admin/queue
GET /admin/queue/sitemaps?status=PENDING
GET /admin/queue/sitemaps?status=PROBLEM
POST /admin/queue/refresh-sitemaps
POST /admin/queue/process
POST /admin/queue/sitemaps/retry-problems
POST /admin/queue/sitemaps/:id/retry
```

Dukon queue:

```http
GET /admin/queue/dukon
GET /admin/queue/dukon/sitemaps?status=PENDING
POST /admin/queue/dukon/refresh-sitemaps
POST /admin/queue/dukon/process
POST /admin/queue/dukon/sitemaps/retry-problems
POST /admin/queue/dukon/sitemaps/:id/retry
```

## First Production Rollout

1. Deploy DB schema update and regenerate Prisma client.
2. Start backend with cron disabled: `PARSER_CRON_ENABLED=false`.
3. Create or verify `Source` records for `th-tools`, `dukon`, `tools-by`, and optional `7745`.
4. Dry-run 20 real URLs per priority source through `/admin/source-products/preview`.
5. Fix selector issues until previews consistently include `name`, reasonable `priceValue`, `images`, `specifications`, and breadcrumbs/category data.
6. Import 5-10 individual URLs per source through `/admin/source-products/import`.
7. Check `/admin/queue/supplier-summary` for missing price/images/SKU counts.
8. Refresh `th-tools` and `dukon` queues only after single URL imports look safe.
9. Process small batches: `limit=20`, concurrency stays controlled in service code.
10. Review `FAILED`/`SKIPPED`, `/admin/queue/errors`, and product quality before increasing batch size.

## What To Check After Every Batch

- Queue stats: pending/done/failed/skipped.
- Parser errors: exact messages and URLs.
- Product quality counts: missing images, missing price, missing SKU.
- A few random product pages in frontend.
- Category mapping: source categories should be mapped when internal categories matter for navigation.

## Notes For Future Sessions

- `tools.by` parsing helper is `backend/src/parser/sites/tools.parser.ts`; catalog-saving service is `tools-by-source.parser.ts`.
- `th-tools` parsing helpers are private methods inside `th-tools.parser.ts` and covered by `th-tools.parser.spec.ts`.
- `dukon` has the most mature parser helper coverage in `dukon.parser.spec.ts`.
- If adding a new safety feature, prefer implementing it once in each priority source rather than only one parser.
- Do not enable broad cron before dry-run and small batch checks are clean.
