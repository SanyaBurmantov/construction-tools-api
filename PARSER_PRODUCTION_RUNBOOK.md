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

## tools.by: resumable discovery and scheduled revalidation (2026-10-09)

Deployment must apply migration `20261009000000_parser_catalog_crawl` before
starting the updated backend. The production Dockerfile already runs
`prisma migrate deploy` on startup; a non-Docker deployment must run it explicitly.

Catalog discovery checkpoints its pending category URLs, visited URLs, Livewire
pagination snapshots and session cookies in `ParserCatalogCrawl` after each page.
The next manual or daily refresh continues that queue after reaching `maxPages`,
a fetch error or a backend restart. Once the queue is empty, the checkpoint is
removed and the next refresh begins a new full pass. Failed pages are replayed;
product URL upserts are idempotent. HTTP 419 renews the session while retaining
the pagination snapshot; renewal requests also count against `maxPages`.

New tools.by defaults are `maxPages=2000`, `batchLimit=300`, and the existing
`requestDelayMs=2000`. DB settings and environment variables retain priority.
`maxPages` is a per-run request budget, including loadMore and session renewal,
not a limit on the total catalog. `visitedPages` and `discoveredProducts` in the
refresh result describe the current run; `remainingPages` is its saved tail.
At the default delay, 2000 requests require at least 67 minutes; response times
add to that. A product batch of 300 requires at least 10 minutes with concurrency 1.

Revalidation runs on the first day of each month at 12:30 in the scheduler's
existing timezone, via the same guarded job runner as manual actions. Both the
global and tools.by cron switches must be enabled. Revalidation resets product
URLs to PENDING, including failed/skipped rows, just like the manual action.
Discovery continues to enqueue new URLs without resetting existing DONE rows.

After deploying, start one manual revalidation in `/admin/parsing` to update
existing prices immediately instead of waiting for the next monthly tick.
Then start catalog discovery. Equivalent authenticated API requests (prefix
`/api` through Caddy) are:

```http
POST /admin/parser/sources/tools-by/jobs/revalidate/run
x-admin-token: <ADMIN_TOKEN>

POST /admin/parser/sources/tools-by/jobs/refresh/run
x-admin-token: <ADMIN_TOKEN>
```

The requests return immediately; poll
`GET /admin/parser/sources/tools-by/jobs` until the corresponding job has finished.
Check queue counts and refresh `remainingPages`; another refresh continues any
saved tail. Verify tools-by-process reports nonzero processed counts and
SourceProduct.lastSync advances. If existing overrides keep the old limits, use:

```http
PATCH /admin/parser/sources/tools-by
x-admin-token: <ADMIN_TOKEN>
Content-Type: application/json

{ "maxPages": 2000, "batchLimit": 300 }
```

A full queue takes multiple process ticks: at 300 URLs every 30 minutes, 5971
URLs need 20 successful batches (about 10 hours), and 30000 URLs need 100
(about 50 hours). These estimates exclude errors, slow requests and missed ticks.

Production audit on 2026-10-09 confirmed the running container explicitly sets
`TOOLS_BY_DISCOVERY_MAX_PAGES=500` and `DUKON_CRON_BATCH_LIMIT=20`. Existing
`.env.prod` values override Compose fallbacks too: patch maxPages via the admin
API after deploy or change that environment value before rebuilding.
Catalog GET and Livewire requests now use a separate
`TOOLS_BY_CATALOG_FETCH_TIMEOUT_MS=60000` fallback; product requests retain the
global `PARSER_FETCH_TIMEOUT_MS` budget. Exhausted fetch errors include the URL,
number of attempts and timeout, and preserve the original error as their cause.
The historical tools-by-refresh failure was a catalog GET timeout; its log did
not include the URL, so the specific slow page cannot be established retrospectively.

## Navigation category repair and price freshness (2026-10-09)

Deploy both the backend and frontend, including migrations
`20261009000000_parser_catalog_crawl` and
`20261009010000_repair_navigation_category`. The repair runs automatically during
`prisma migrate deploy`; it runs in one transaction and temporarily blocks catalog
writers. Apply it before starting the updated backend. Take the normal database
backup before deploying a data migration.

The repair removes the legacy root `Главная` (`glavnaya`), strips that prefix from
category identities, repairs detached legacy paths, and merges duplicate branches
into existing canonical categories. Products directly attached to the navigation
root move to the existing hidden supplier fallback category. Product prices,
publication statuses, source offers, images and synchronization dates are preserved.
Source-category mappings and category pricing rules follow the merged categories.
The shared category builder now drops `Главная` and `Каталог` navigation crumbs.

Removed public slugs are stored in `CategoryRedirect`; category requests resolve
them to the canonical slug and the storefront redirects to that address while
preserving query parameters. Subsequent manual category merges also transfer
aliases and pricing rules. Breadcrumbs follow actual parent IDs instead of
assuming that identity components are public slugs.

When merging specification definitions produces different values for the same
product/key, the existing canonical definition's value wins. The other values
are retained in `CategoryRepairConflict` with product ID, source and target
definition IDs and the retained value. Identical duplicates are folded without
creating archive rows. Review conflicts after deployment with:

```sql
SELECT count(*) FROM "CategoryRepairConflict";
SELECT "productId", "fromSpecificationId", "toSpecificationId", value, "keptValue"
FROM "CategoryRepairConflict" ORDER BY "productId" LIMIT 100;
SELECT count(*) FROM "Category" WHERE path[1] = 'glavnaya';
```

Verification on an isolated copy of production catalog data: categories
1689 → 1299; all 31901 products and 48250 source offers preserved; 390 old URLs
retained; 8914 conflicting specification values archived; zero lost characteristic
values and zero broken parent paths. Production itself was not modified.
The SQL regression covers duplicate branches, detached paths, missing prefixes,
pricing rules, mappings, image/offer preservation, specification conflicts, and a
clean database without the legacy root. Run it against a local disposable database:

```sh
cd backend
psql -X -v ON_ERROR_STOP=1 -d parser_repair_test -f test/sql/category-navigation-repair.sql
```

`GET /health/parser` and the admin parsing screen now expose per-source freshness:
total purchasable offers, stale count/share, oldest/newest synchronization and
`OK`/`STALE`/`EMPTY`. Only positive-priced, in-stock offers linked to published
products are counted. Defaults are `PARSER_PRICE_MAX_AGE_HOURS=48` and
`PARSER_PRICE_STALE_PERCENT=10`; health becomes unhealthy when at least 10% of
eligible offers are older than 48 hours, even if process runs succeed with zero
processed URLs. A smaller stale tail remains visible in the counters.

The existing watchdog checks freshness and uses the existing Telegram problem
notification configuration. It sends one notification per incident and permits
another after recovery; failed delivery is retried. Missed process runs use a
2-hour allowance, daily refreshes 26 hours, monthly revalidation 32 days.
Unscheduled TH-tools manual revalidation is not considered late. Disabled source
cron jobs do not trigger missed-job alerts; stale customer-facing prices remain
visible. The global cron switch still controls watchdog execution.

A successful cron is not enough to guarantee freshness: processing capacity must
cover the catalog. The audited production Dukon override `batchLimit=20` permits
only 960 URLs/day before retries, too little for a two-day cycle over roughly
3500 products. After deploying, raise its batch limit through the admin source
settings (for example, start at 100 and inspect duration/failures). TH-tools also
needs capacity checked against its much larger offer count. Do not change freshness
thresholds merely to make health green; verify that `lastSync` advances across the
catalog and that stale counts fall after increasing processing capacity.
