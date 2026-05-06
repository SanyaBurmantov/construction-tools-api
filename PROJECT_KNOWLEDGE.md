# Project Knowledge Base

## Overview

This repository contains a construction tools catalog with a NestJS backend, PostgreSQL via Prisma, and a Nuxt 4 frontend.

The product domain is built around parsed supplier products, normalized catalog entities, and an admin panel for manual management.

## Product Goal

This project is intended to become an internet shop for construction tools, fasteners, consumables, and related goods.

The core idea:

- Products are collected from supplier websites by parsers.
- Parsed supplier data is normalized into the internal catalog: products, categories, brands, images, prices, descriptions, and specifications.
- The public website shows the resulting catalog as an online shop with SEO-friendly product pages.
- The admin panel is used to review, create, edit, delete, merge, and correct parsed catalog data.
- Supplier data should be treated as a starting point, not as final truth: admins can manually fix product names, categories, brands, descriptions, prices, and other fields.

Current commerce state:

- The project currently behaves more like a catalog/admin-backed storefront than a full checkout shop.
- Cart, orders, payments, delivery, user accounts, and stock reservation are not implemented yet unless added later.
- Product pages currently expose product details and source links; the shop flow can be extended later.

## Repository Layout

- `backend/`: NestJS API, Prisma schema, parser services, admin API.
- `frontend/`: Nuxt 4 SSR/ISR frontend and admin UI.
- `backend/prisma/schema.prisma`: database model source of truth.
- `frontend/nuxt.config.ts`: Nuxt SSR/ISR/proxy configuration.

Frontend deployment note: public pages use Nuxt route rules with both `isr` and `swr`. `/api/*` is proxied by `frontend/server/api/[...path].ts` at runtime through `API_BASE_SERVER`; this avoids baking the backend URL at Docker build time.

## Backend

### Stack

- NestJS 11.
- Prisma 5.
- PostgreSQL.
- Validation via global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform` enabled.
- CORS enabled from `CORS_ORIGIN`, or all origins when not set.
- Swagger is enabled outside production or when `SWAGGER_ENABLED=true`.

### Important Env Vars

- `DATABASE_URL`: PostgreSQL connection string.
- `PORT`: backend port, default `8000`.
- `CORS_ORIGIN`: optional comma-separated frontend origins.
- `ADMIN_TOKEN`: token required by admin endpoints through `x-admin-token`.
- `SWAGGER_ENABLED`: enables Swagger in production when `true`.
- `PARSER_CRON_ENABLED`: when `true`, enables automatic supplier parser cron jobs.

### Main Modules

- `ProductsModule`: public product API.
- `CategoriesModule`: public categories API.
- `BrandsModule`: public brands API.
- `SourcesModule`: source and source product API.
- `ParserModule`: parser and sitemap processing.
- `AdminModule`: guarded admin API.
- `PrismaModule`: Prisma client service.

### Data Model

Core Prisma models:

- `Category`: tree structure with `parentId`, `level`, `path`, SEO fields.
- `Brand`: brand profile with `slug`, optional `logo`, `country`, SEO fields.
- `Product`: normalized catalog product. Has `brand`, required `category`, images, specs, source links.
- `ProductImage`: currently stores image URLs. At the moment URLs can point to supplier image URLs.
- `Specification`: category-specific specification definition, unique by `[categoryId, key]`.
- `ProductSpecification`: product values, unique by `[productId, specificationId]`.
- `Source`: supplier/source record with unique `code`.
- `SourceProduct`: supplier product link/data connected optionally to normalized `Product`. It stores supplier URL identity, separate supplier `sku`/article, price, images, description, specifications, and category mapping.
- `SitemapsThTools`: queue of th-tool.by product URLs with `PENDING`, `DONE`, `FAILED`, and `SKIPPED` statuses, attempts, and last error metadata. Legacy `isVisited` remains for compatibility.
- `SitemapsDukon`: queue of dukon.by catalog URLs with `PENDING`, `DONE`, `FAILED`, and `SKIPPED` statuses, attempts, and last error metadata.

## Public API

### Health

- `GET /health/parser`: public/internal-safe parser cron health endpoint for uptime monitoring. It returns overall `ok`, max accepted job age, and sanitized job statuses without admin token or parser error details.

### Products

- `GET /products`: filtered product list.
- `GET /products/:slug`: product detail by slug.
- `POST /products`: basic public product creation endpoint exists but most management should happen through admin.

Product list supports filters in `ProductFilterDto`:

- `search`
- `categoryId`
- `brandId`
- `sourceCode`
- `priceMin`
- `priceMax`
- `sortBy`
- `sortOrder`
- `page`
- `limit`

### Categories and Brands

- Public category and brand controllers/services exist for catalog facets.

### Sources

- `GET /sources`
- `POST /sources`
- `GET /source-products`

Public source/source-product APIs are read-only. Supplier import and mutations should go through guarded admin endpoints.

## Admin API

Admin routes are guarded by `AdminGuard`; frontend sends `x-admin-token`.

Base path: `/admin`.

### Dashboard

- `GET /admin/stats`: counts products, categories, brands, sources, queued sitemaps.

### Products

- `GET /admin/products`: paginated/filterable product list with `brand` and `category` included.
- `POST /admin/products`: create product.
- `PATCH /admin/products/:id`: update product.
- `DELETE /admin/products/:id`: delete product and related images/spec values; source product links are detached.

### Brands

- `GET /admin/brands`
- `POST /admin/brands`
- `PATCH /admin/brands/:id`
- `DELETE /admin/brands/:id`: deletes brand and sets affected products `brandId` to null.
- `POST /admin/brands/:id/merge`: moves all products from source brand to target brand, then deletes source brand.

Merge DTO:

```ts
{ targetBrandId: string }
```

### Categories

- `GET /admin/categories`
- `POST /admin/categories`
- `PATCH /admin/categories/:id`
- `DELETE /admin/categories/:id`

Category creation calculates `level` and `path` from parent.

### Parsing and Sources

- `GET /admin/sources`
- `GET /admin/queue`
- `GET /admin/queue/sitemaps`
- `GET /admin/queue/errors`
- `DELETE /admin/queue/errors`
- `POST /admin/queue/refresh-sitemaps`
- `POST /admin/queue/process`
- `POST /admin/source-products/import`
- `POST /admin/source-products/preview`: dry-run parser preview for one supplier URL without writing `Product`/`SourceProduct` records.
- `POST /admin/queue/sitemaps/:id/retry`
- `POST /admin/queue/sitemaps/retry-problems`
- `GET /admin/queue/dukon`
- `GET /admin/queue/dukon/sitemaps`
- `POST /admin/queue/dukon/refresh-sitemaps`
- `POST /admin/queue/dukon/process`
- `POST /admin/queue/dukon/sitemaps/:id/retry`
- `POST /admin/queue/dukon/sitemaps/retry-problems`
- `GET /admin/queue/runtime-status`: persisted parser/cron runtime status by job.
- `GET /admin/queue/health`: parser cron health summary. Jobs are `OK`, `RUNNING`, `ERROR`, or `STALE` based on latest persisted runtime status.
- `GET /admin/queue/supplier-summary`: per-source catalog quality summary: total/published/draft/hidden/archived and missing price/images/SKU counts.

`POST /admin/source-products/import` imports a single product from a selected source and URL. `POST /admin/source-products/preview` uses the same parser selection logic but returns parsed JSON only and does not write catalog records. Currently these endpoints support `th-tool.by`/`th-tools`, `dukon.by`/`dukon`, `tools.by`/`tools-by`, and `7745.by`/`7745`.

Import DTO:

```ts
{ sourceId: string, url: string }
```

Production parser rollout notes are maintained in `PARSER_PRODUCTION_RUNBOOK.md`.

## Parser

Legacy parser trigger routes `GET /products-from-sitemap-initial` and `GET /sitemap-initial` still exist, but are guarded by `AdminGuard`. Prefer `/admin/queue/*` endpoints from the admin panel for normal operations.

### Current Main Parser

Primary supplier focus is now `dukon`, `th-tools`, and `tools-by`. `7745.by` remains available as a secondary source, but its cron is disabled by default and requires `SUPPLIER_7745_CRON_ENABLED=true`.

`backend/src/parser/sites/th-tools.parser.ts` is an active catalog-saving parser.

`backend/src/parser/sites/dukon.parser.ts` is also wired into admin import and its own sitemap queue. It stores supplier data in `SourceProduct`, tracks queue item status, and uses a low-concurrency delayed batch process.

`backend/src/parser/sites/7745-source.parser.ts` is the catalog-saving parser for `7745.by`. It uses the helper parser in `7745.parser.ts`, stores normalized `Product`, rich `SourceProduct` snapshots, category/brand/spec data, and tracks queue items in `Sitemaps7745`.

`backend/src/parser/sites/tools-by-source.parser.ts` is the safe catalog-saving parser for `tools.by` single URL imports. `tools.by` has `robots.txt` with `Disallow: /` and no public sitemap, so do not run unattended discovery/cron unless supplier permission/access changes. Manual admin import supports `tools.by/product/...` URLs and writes normalized `Product`, `SourceProduct`, category, brand, image and specification data.

Dukon category behavior: breadcrumbs create both `SourceCategory` records and internal `Category` records. If a source category has a manual mapping, the mapped internal category is used; otherwise the parsed internal breadcrumb leaf category is used for `Product.categoryId`.

Dukon automation uses `DukonCron` when `PARSER_CRON_ENABLED=true`:

- every 30 minutes: processes up to `DUKON_CRON_BATCH_LIMIT` pending Dukon URLs with concurrency `1`; default `30`;
- every day at 06:00: refreshes Dukon sitemap and adds newly found URLs as `PENDING`;
- every 1st day of month at 12:00: refreshes sitemap and resets all Dukon queue items to `PENDING` for monthly revalidation.

7745 automation uses `Supplier7745Cron` when `PARSER_CRON_ENABLED=true`:

- every 30 minutes: processes up to `SUPPLIER_7745_CRON_BATCH_LIMIT` pending 7745 URLs with concurrency `1`; default `30`;
- every day at 06:20: refreshes `https://7745.by/sitemap.xml` and adds discovered catalog URLs as `PENDING`.

7745 cron also requires `SUPPLIER_7745_CRON_ENABLED=true`; default is `false` so `PARSER_CRON_ENABLED=true` focuses on priority sources instead of the broad 7745 catalog.

7745 sitemap detail: root sitemap is an index. Product URLs are loaded from `https://7745.by/sitemaps/products_*.xml`, canonicalized by removing URL hashes like `#p175`, and stored in `Sitemaps7745`.

Latest local 7745 smoke test: migration `20260506000100_add_7745_sitemaps` applied, refresh loaded `66696` product URLs. After live selector fixes, controlled batches processed `40` products successfully with `0 FAILED`; `40` `SourceProduct` snapshots were saved, and quality counts for saved 7745 products were `withoutImages=0`, `withoutPrice=0`, `withoutSku=0`.

7745 parser caveat: the site can return an anti-bot `Verification` page to backend fetches. The parser now detects this and refuses to save it as a product. If verification responses return again at scale, treat them as a fetch/access issue rather than product data quality.

Remaining 7745 work before unattended full import:

- run a larger sample of several hundred URLs and check `DONE/FAILED/SKIPPED` ratio;
- review category accuracy for mixed supplier categories and add source-category mappings where needed;
- decide whether to keep all `66696` products or limit by priority branches/categories;
- later move product images from supplier URLs to first-party object storage/CDN.

7745 category selection can be controlled with env regex filters checked against breadcrumbs:

- `SUPPLIER_7745_CATEGORY_INCLUDE_REGEX`: if set, only matching category paths are imported;
- `SUPPLIER_7745_CATEGORY_EXCLUDE_REGEX`: matching category paths are marked `SKIPPED` and not saved.

Current recommended exclude draft for construction/tools focus: `семена|зоотовары|аквариум|кухон|ванн|космет|спорт|единоборств|эпилятор|яйцевар|наушник|гарнитур`.

Current recommended include draft for construction/tools focus: `запчаст|инструмент|электроинструмент|оснаст|оборудован|строй|строител|отделоч|крепеж|фурнитур|сантех|климат|электрик|спецодеж|сиз|садовая техника|автотовар`.

Filter smoke test with recommended include/exclude processed another sample successfully: queue reached `DONE=177`, `SKIPPED=7`, `FAILED=0`. Skipped examples were non-target categories: cat food, electric shavers, toasters, office PCs, seeds, fishing feeders, car cosmetics.

Dukon discovery priority is currently focused on `Наборы инструментов и специнструмент` (`/catalog/nabory-instrumentov/`). This branch has about `23134` products and is discovered through category pagination before child category pages. Discovery has a safety cap controlled by `DUKON_DISCOVERY_MAX_PAGES`, default `5000`.

During Dukon discovery, category pages also persist the category tree. The parser stores the current category from breadcrumbs plus `h1`, and all visible child category links, into both `SourceCategory` and internal `Category`.

Article/SKU handling is important: parsers should save article numbers into both normalized `Product.sku` when appropriate and supplier snapshot `SourceProduct.sku` as a separate field. Do not store supplier articles only inside free-form specifications.

Th-tools, Dukon, Tools.by, and 7745 parser flows now write `SourceProduct` snapshots themselves. Admin single import should call the parser and avoid overwriting parser-created snapshots with empty fallback data.

Parser-created supplier products are intended to be storefront-visible by default: new th-tools and Dukon products are created as `PUBLISHED`. On reparse, only existing `DRAFT` products are promoted to `PUBLISHED`; manually hidden or archived products stay `HIDDEN`/`ARCHIVED`.

New supplier development guide: `SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md`. Use it when adding another supplier parser so each source writes both normalized `Product` data and a rich `SourceProduct` snapshot.

Dukon product snapshots now preserve extra card metadata. The normalized `Product` stores model, barcode, old price, stock status, short/full descriptions, SEO title/description, images, specs, SKU, brand, category and price. `SourceProduct.specifications` stores `{ attributes, source }`, where `source` includes canonical URL, breadcrumbs, JSON-LD product data, stock status, SEO fields and parse timestamp.

Homepage product rail uses `/products?limit=8&sortBy=createdAt&sortOrder=desc`, so newly parsed and published supplier products appear on the frontend homepage without old maintenance updates pushing stale records to the top.

Parser cron observability:

- `ParserRuntimeStatus` stores last run state for cron jobs in DB, so status survives backend restarts.
- Admin parsing UI shows runtime status and supplier catalog quality summary.
- Admin health endpoint reports stale/error cron jobs for deployment checks.
- Public/internal `GET /health/parser` can be used by external uptime monitoring without exposing admin endpoints.
- Supplier summary helps verify that imported products are visible and have core storefront data: price, image, SKU.
- Public catalog supports `sourceCode`, for example `/catalog?sourceCode=dukon`, to inspect one supplier's storefront-visible products.

Dukon parsing helpers have a fixture-backed unit test in `backend/src/parser/sites/dukon.parser.spec.ts`. It validates current Dukon selectors for SKU, brand, price, description, images, breadcrumbs, child categories, listing product links, and pagination.

Important methods:

- `processSitemapsBatch(limit, concurrency)`: processes unvisited sitemap URLs.
- `processSitemapUrl(url)`: parses a URL, saves product, marks matching sitemap record visited.
- `parseProductUrl(url)`: parses and saves a single th-tool.by product URL, returns saved product.
- `parseAndSaveCategory($)`: derives category path from breadcrumbs.
- `saveSpecifications(specs, productId, categoryId)`: upserts specs and product spec values.

Known parser behavior:

- Product slug is generated from product name.
- Brand is upserted from `.product__top-brand-name`.
- Category is built from breadcrumbs; fallback category is `Tools`.
- Product images are currently saved as remote source URLs.
- Currency is forced to `BYN` for th-tool.by because parsing symbol text previously produced invalid values like `Ñ\x80`.

### Parser Logs

`ParserLogService` persists parser errors in the `ParserError` table for admin display. Check `/admin/queue/errors` from UI/API. The admin clear action deletes persisted parser errors.

## Frontend

### Stack

- Nuxt 4.
- Vue 3.
- SSR enabled globally.
- Nuxt UI installed.
- SCSS with global mixins configured in Vite preprocessor options.

### Runtime Config

`frontend/nuxt.config.ts`:

- Server API base: `API_BASE_SERVER || API_BASE || http://localhost:8000`.
- Public API base: `NUXT_PUBLIC_API_BASE || /api`.
- `/api/**` is proxied to backend.

### SSR and ISR Rules

Current route rules:

```ts
routeRules: {
  '/': { isr: 3600 },
  '/catalog/**': { ssr: true },
  '/product/**': { isr: 86400 },
  '/admin/**': { ssr: false },
  '/api/**': { proxy: `${process.env.API_BASE_SERVER || process.env.API_BASE || 'http://localhost:8000'}/**` }
}
```

Meaning:

- Home page uses ISR for 1 hour.
- Catalog stays SSR.
- Product pages use ISR for 1 day.
- Admin is client-side only.
- API is proxied through Nuxt.

### Public Pages

- `/`: home page.
- `/catalog`: catalog with filters, facets, sorting, pagination.
- `/product/:slug`: product detail.

Product price display is defensive: if `priceCurrency` is missing or not a 3-letter ISO code, frontend uses `BYN`.

### Admin Pages

Nuxt nested route detail:

- `frontend/app/pages/admin.vue` must remain a parent wrapper with `<NuxtPage />`.
- `frontend/app/pages/admin/index.vue` is the admin dashboard.
- Child pages:
  - `/admin/products`
  - `/admin/categories`
  - `/admin/brands`
  - `/admin/parsing`

Do not move dashboard content back into `admin.vue`, or child routes will render incorrectly.

### Admin Token Handling

`frontend/app/composables/useAdminApi.ts`:

- Uses `useState('admin-token')`.
- Loads/saves token from `localStorage`.
- Sends `x-admin-token` header to `/admin` endpoints.

### Admin Products UI

`frontend/app/pages/admin/products.vue`:

- Product list with filters.
- Create/edit product uses a modal dialog.
- Page body scroll is locked while product modal is open.
- Product preview is inline on the page.
- Public product page can be opened from preview.

### Admin Brands UI

`frontend/app/pages/admin/brands.vue`:

- Brand create/edit/delete.
- Brand merge form: source brand plus target brand.
- Merge moves products to target brand and deletes source brand.

### Admin Parsing UI

`frontend/app/pages/admin/parsing.vue`:

- Queue stats.
- Refresh sitemap.
- Process 25 queued products.
- Clear parser errors.
- Sitemap list with status filter/search.
- Single product import from source: choose source, paste product URL, parse and save.

## Current Known Issues and Constraints

- Frontend production build fails in this environment with Node `v21.5.0`: `crypto.hash is not a function` from Vite/Nuxt. Use Node `22.12+` or compatible `20.19+`.
- Backend lint has existing warnings in parser/products around `any` usage, but no current errors.
- Single URL import currently supports th-tool.by, tools.by, dukon.by, and 7745.by.
- Product images currently store remote supplier URLs; object storage integration is not implemented yet.
- Admin category delete may fail if DB constraints block deleting categories with children/products.

## Image Storage Recommendation

Recommended production storage for parsed product images: S3-compatible object storage.

Best default option: Cloudflare R2 plus Cloudflare CDN.

Suggested flow:

- Parser downloads supplier image.
- Backend converts/optimizes to WebP when feasible.
- Backend uploads to object storage.
- `ProductImage.url` stores a first-party CDN URL.
- Suggested key pattern: `products/{productId}/{order}-{hash}.webp`.

Alternatives:

- Selectel Object Storage for RU/CIS infrastructure.
- Yandex Object Storage if already using Yandex Cloud.
- AWS S3 if AWS infrastructure is desired.

Avoid local `/uploads` for production except as a temporary development fallback.

## Deployment Notes

Recommended VPS for current project:

- 2 vCPU.
- 4 GB RAM.
- 40 GB SSD.
- Ubuntu 22.04/24.04.

Services to run:

- PostgreSQL.
- NestJS backend.
- Nuxt frontend server.
- Nginx or Caddy reverse proxy.
- Optional PM2 or Docker Compose.

Minimal VPS for small traffic/testing:

- 1 vCPU.
- 1-2 GB RAM.
- 20 GB SSD.

If active parsing runs on the same host, prefer at least 2 vCPU and 4 GB RAM.

## Common Commands

Node.js version:

Use Node `22.12.0` or newer compatible Node `22.x`. The repo has root, backend, and frontend `.nvmrc` files pinned to `22.12.0`, and backend/frontend `package.json` require `node >=22.12.0`.

Backend:

```bash
cd backend
npm run build
npm run lint
npm run start:dev
```

Frontend:

```bash
cd frontend
npm run lint
npm run dev
npm run build
```

Nuxt route/type regeneration:

```bash
cd frontend
npx nuxi prepare
```

## Editing Notes for Future Work

- Prefer minimal changes; existing admin pages are compact and often use one-line templates/styles.
- When changing admin routes, remember Nuxt nesting: `admin.vue` is parent, `admin/index.vue` is dashboard.
- When adding admin API fields, update DTOs because backend validation forbids non-whitelisted fields.
- When adding support for a new source parser, wire both parsing and saving to normalized catalog models, not just `SourceProduct` memory stubs.
- For price formatting, always ensure `priceCurrency` is a valid ISO 4217 code before passing it to `Intl.NumberFormat`.
