---
name: add-parser
description: Add a new supplier parser to the backend (construction-tools-api). Use when asked to "add a parser", "add a supplier/source", "parse site X", "sparsit'/добавить парсер/поставщика/источник", or to wire a new product source into the catalog. Covers the queue model, pure parse function, parser service, cron, module wiring, admin endpoints, env vars, and tests.
---

# Add a new supplier parser

This project ingests supplier products into two layers — `Product` (normalized
storefront card) and `SourceProduct` (raw supplier snapshot). A new parser plugs
into a fixed pipeline. **Copy the `7745` source as the reference implementation.**

Reference files (read these before writing anything):
- `backend/src/parser/sites/7745-source.parser.ts` — the full service (the template).
- `backend/src/parser/sites/7745.parser.ts` — the pure `parse7745(html)` function.
- `backend/src/parser/sites/7745.cron.ts` — the cron.
- `backend/src/parser/sites/7745.parser.spec.ts` + `fixtures/7745-product.html` — the test.
- `SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md` — field-by-field normalization rules (read it).

## Pipeline (what you are plugging into)

```
sitemap.xml ──refreshSitemaps()──▶ Sitemaps<Source> queue (PENDING)
                                        │
        cron (every 30 min) ──processSitemapsBatch(limit, conc)──┐
                                        │                         │ pop PENDING
                                        ▼                         ▼
                                processSitemapUrl(url) ──▶ parseProductUrl(url)
                                        │                         │ fetch HTML
                                        │                         │ parse<Source>(html)  (pure)
                                        │                         │ upsert Product (+images+specs)
                                        │                         │ upsert SourceProduct
                                        ▼                         ▼
              mark row DONE / SKIPPED / FAILED          ParserError (on FAILED)
                                        │
                          cron writes ParserRuntimeStatus ──▶ GET /health/parser
```

## Decide the identifiers first

- `SOURCE_CODE` — stable kebab/short code, e.g. `7745`, `dukon`. Used in `Source.code`,
  cron env flags, and source matching. Pick once, never change.
- `SOURCE_NAME` (display, e.g. `7745.by`), `SOURCE_BASE_URL`, `SOURCE_SITEMAP_URL`.
- Queue model name: `Sitemaps<Pascal>` (e.g. `Sitemaps7745`, `SitemapsToolsBy`).

## Steps

### 1. Queue model + migration
Add a queue model to `backend/prisma/schema.prisma`, identical in shape to
`Sitemaps7745` (fields: `id`, `url @unique`, `isVisited`, `status @default("PENDING")`,
`attempts`, `lastError?`, `lastTriedAt?`, `visitedAt?`). Then:
```bash
cd backend && npx prisma migrate dev --name add_<code>_sitemaps
```
Commit the generated migration. (Status values used in code: `PENDING`, `DONE`,
`FAILED`, `SKIPPED`; the UI also treats `PROBLEM` = `FAILED|SKIPPED`.)

### 2. Pure parse function — `sites/<code>.parser.ts`
Export `parse<Code>(html: string): TParsedProduct` (`{ name, price?, images, description?, specifications[] }`).
- Use `cheerio`; prefer **JSON-LD** (`script[type="application/ld+json"]`, walk `@graph`),
  then `h1` / `og:title` for name, gallery + `og:image` for images.
- Filter junk images (`isProductImage`): drop `data:`, `/resize_cache/`,
  `/bitrix/templates/`, `logo`, `sprite`, non `jpg|png|webp`. Dedupe, keep gallery order.
- Keep this function **DB-free and deterministic** so it can be unit-tested.

### 3. Parser service — `sites/<code>-source.parser.ts`
`@Injectable()` with `PrismaService` + `ParserLogService`. Implement the public API
(copy method bodies from `7745-source.parser.ts` and adjust selectors/URL rules):
- `refreshSitemaps()` — upsert source, fetch sitemap(s), `enqueueUrls()`.
- `getQueueStats()`, `getSitemaps(query)`, `retrySitemap(id)`, `retryProblemSitemaps()`.
- `processSitemapsBatch(limit = 30, concurrency = 1)` — `publishDraftProducts()` then
  pop `PENDING` and run via `runWithConcurrency`, with a `REQUEST_DELAY_MS` sleep.
- `processSitemapUrl(url)` — increment `attempts`/`lastTriedAt`, call `parseProductUrl`,
  mark `DONE`; on a `Skipped<Code>Error` mark `SKIPPED` (no ParserError), else `FAILED`
  + `parserLogService.addError`.
- `parseProductUrl(url)` — fetch, `parse<Code>`, guard empty name + anti-bot pages,
  `upsertSource` → categories → brand → **upsert `Product`** → `saveSpecifications` →
  **`saveSourceProduct`**.
- `previewProductUrl(url)` — same parse, **no DB writes**; return the parsed shape.
  Used for prod dry-runs before enabling cron.

Mandatory data rules (see the guide for full detail):
- `Product` identity = `slug` (`productSlug(name, sku)`); `SourceProduct` identity =
  `where: { sourceId_url: { sourceId, url } }`.
- On re-parse, **never publish a `HIDDEN`/`ARCHIVED` product**; only flip `DRAFT`→`PUBLISHED`.
- Currency is an ISO code (`BYN`), not `руб.`. Save price to both `Product.priceValue`
  and `SourceProduct.price`.
- Brand via `Brand.upsert({ where: { slug } })`; specs via `Specification`
  (`@@unique([categoryId, key])`) + `ProductSpecification`; raw specs also into
  `SourceProduct.specifications.attributes`.
- Category: `SourceCategory.mappedCategoryId` if mapped, else build from breadcrumbs,
  else fallback `unmapped-supplier-products`.

### 4. Cron — `sites/<code>.cron.ts`
Copy `7745.cron.ts`. Two `@Cron` methods (process every 30 min, refresh daily) with:
- in-memory overlap guards (`isProcessing`/`isRefreshing`),
- `isEnabled()` = `PARSER_CRON_ENABLED === 'true' && <CODE>_CRON_ENABLED === 'true'`,
- wrap in `runtimeStatus.start/success/failure` with a unique key (`<code>-process`, `<code>-refresh`).

### 5. Wire the modules
- `backend/src/parser/parser.module.ts` — add the service **and** the cron to `providers`.
- `backend/src/admin/admin.module.ts` — add the service to `providers` (cron not needed here).

### 6. Admin endpoints (manual control / diagnostics)
In `admin.controller.ts` + `admin.service.ts` add, mirroring the `7745` block
(`@Get('queue/<code>')`, `queue/<code>/sitemaps`, `@Post('queue/<code>/refresh-sitemaps')`,
`queue/<code>/process`, `queue/<code>/sitemaps/retry-problems`, `queue/<code>/sitemaps/:id/retry`).
Add source matching in `admin.service` `resolveParser` (the `is7745` pattern: match by
`Source.code`, base URL, or the submitted URL) so `POST source-products/preview` and
`/import` route to your `previewProductUrl` / `parseProductUrl`.

### 7. Env vars
Add to `.env.example`, `.env.prod.example`, and `docker-compose.prod.yml` (backend
`environment:`): `<CODE>_CRON_ENABLED` (default `false`), `<CODE>_CRON_BATCH_LIMIT`
(default `30`), and category include/exclude regex if the source needs filtering
(see `SUPPLIER_7745_CATEGORY_*`). Keep cron **disabled** by default.

### 8. Tests
Add `sites/<code>.parser.spec.ts` + `fixtures/<code>-product.html` asserting
`parse<Code>(html)` output (copy `7745.parser.spec.ts`).

## Before you finish — verify
```bash
cd backend
npm run lint          # prettier rules are errors; npm run lint -- --fix
npm run build
npm test -- --runInBand
npx prisma validate
```
Then a **prod dry-run** before enabling cron: deploy with `<CODE>_CRON_ENABLED=false`,
call `POST /api/admin/source-products/preview { "url": "<product-url>" }` with the
`x-admin-token` header, eyeball the parsed fields, then enable cron. See the
`parser-ops` skill for running/monitoring.

## Definition of done (checklist)
- [ ] `Sitemaps<Source>` model + migration committed
- [ ] Pure `parse<Code>` + fixture test passing
- [ ] Service implements full public API, two-layer save, status transitions
- [ ] Cron gated by env flags, writes runtime status
- [ ] Registered in `ParserModule` (service + cron) and `AdminModule` (service)
- [ ] Admin queue endpoints + `resolveParser` matching added
- [ ] Env vars added to both `.env*.example` and `docker-compose.prod.yml`, cron off by default
- [ ] `lint` + `build` + `test` green; preview dry-run looks correct
