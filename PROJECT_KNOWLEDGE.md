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
- `SourceProduct`: supplier product link/data connected optionally to normalized `Product`.
- `SitemapsThTools`: queue of th-tool.by product URLs, with `isVisited` flag.

## Public API

### Products

- `GET /products`: filtered product list.
- `GET /products/:slug`: product detail by slug.
- `POST /products`: basic public product creation endpoint exists but most management should happen through admin.

Product list supports filters in `ProductFilterDto`:

- `search`
- `categoryId`
- `brandId`
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
- `POST /source-products`

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

`POST /admin/source-products/import` imports a single product from a selected source and URL. Currently it supports `th-tool.by`/`th-tools` only.

Import DTO:

```ts
{ sourceId: string, url: string }
```

## Parser

### Current Main Parser

`backend/src/parser/sites/th-tools.parser.ts` is the active catalog-saving parser.

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

`ParserLogService` stores parser errors for admin display. Check `/admin/queue/errors` from UI/API.

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
- Single URL import currently supports th-tool.by only.
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
