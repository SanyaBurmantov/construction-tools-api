# Project Audit And Improvement Plan

## Purpose

This audit captures weak spots in the current internet-shop/catalog project and proposes a practical improvement plan for backend, frontend, parser, data quality, admin UX, and deployment.

The project goal is an online shop where supplier products are parsed into an internal catalog and then corrected through an admin panel.

## Executive Summary

The project has a workable foundation: NestJS API, Prisma/PostgreSQL schema, Nuxt storefront, admin panel, th-tool.by parser, and basic SSR/ISR rules.

The main weak areas are:

- Catalog data quality is fragile because parser output writes directly into core product tables.
- Admin authentication is very basic and stores the token in `localStorage`.
- Parser is tightly coupled to one supplier and one HTML layout.
- Product images still depend on supplier URLs.
- Public ecommerce features are not implemented yet: cart, orders, checkout, delivery, payment, stock workflow.
- Frontend admin pages are functional but hard to maintain because several files use dense one-line templates/styles.
- Backend has limited domain validation and no automated tests for critical flows.
- Deployment/runtime is not fully pinned; current local Node version breaks Nuxt production build.

## Priority Levels

- P0: must fix before real production.
- P1: important for stable MVP.
- P2: improves quality, scale, maintainability.
- P3: later enhancement.

## Backend Weak Spots

### P0: Public Mutation Endpoints Are Too Open

Current state:

- Public controllers include creation endpoints like `POST /products`, `POST /sources`, `POST /source-products`, and likely similar create endpoints for entities.
- Admin has guarded endpoints, but public mutation endpoints are not clearly protected.

Risk:

- Anyone could create products/sources if API is exposed publicly.
- Data integrity and security risk.

Plan:

- Remove public mutation endpoints that are not required by the storefront.
- Or guard them with admin/auth guards.
- Keep public API mostly read-only: catalog, product detail, categories, brands.

### P0: Admin Auth Is Token-Only And Stored In localStorage

Current state:

- Admin API uses `x-admin-token` compared to `ADMIN_TOKEN`.
- Frontend stores token in `localStorage`.

Risk:

- XSS means admin token leak.
- No sessions, expiration, roles, audit trail, or per-user accountability.

Plan:

- For MVP: keep token but add strong `ADMIN_TOKEN`, HTTPS only, and strict CSP.
- Better: implement login endpoint with httpOnly secure cookie session/JWT.
- Add admin user model later if multiple admins are expected.
- Add audit log for destructive operations: product delete, brand merge, category delete, parser import.

### P0: Parser Writes Directly Into Final Product Tables

Current state:

- `ThToolsParserService.parseProductUrl` upserts `Product`, `Brand`, `Category`, `ProductImage`, and specifications directly.

Risk:

- Bad supplier markup or parsing bug pollutes production catalog immediately.
- Manual edits can be overwritten by later parser runs.
- No review/publish workflow.

Plan:

- Introduce import staging model or status fields.
- Store raw supplier product in `SourceProduct` first.
- Add normalized `Product` only after matching/review rules.
- Track field ownership: parsed value vs admin override.
- At minimum: add `Product.status` like `draft`, `published`, `hidden` and avoid publishing new parsed products automatically.

### P0: Product Images Depend On Supplier URLs

Current state:

- `ProductImage.url` stores remote supplier image URLs.

Risk:

- Supplier can block hotlinking, change URLs, remove images, or slow down pages.
- SEO/performance depends on supplier servers.

Plan:

- Add S3-compatible object storage, recommended Cloudflare R2.
- Parser downloads supplier images, validates content type/size, optionally converts to WebP, uploads to storage.
- Store first-party CDN URLs in `ProductImage.url`.
- Add fields if needed: `sourceUrl`, `storageKey`, `width`, `height`, `hash`.

### P1: Category Tree Updates Are Incomplete

Current state:

- Category create calculates `level` and `path`.
- Category update recalculates only current category partially.
- Children are not recursively updated when parent/slug changes.

Risk:

- Category tree can become inconsistent.
- Breadcrumbs and filters can break later.

Plan:

- Prevent changing parent if children exist until recursive update exists.
- Implement transaction to update descendants' `level` and `path`.
- Prevent cycles: category cannot be parent of itself or descendant.

### P1: Category Delete Is Unsafe UX/API

Current state:

- Admin delete category directly calls Prisma delete.

Risk:

- DB errors if products/children exist.
- Admin gets generic failure.

Plan:

- Add pre-delete checks: products count, children count.
- Return clear error with counts.
- Add safer actions: reassign products, move children, hide category.

### P1: Product Update Accepts DTO Directly

Current state:

- `updateProduct(id, dto)` passes `data: dto` to Prisma.

Risk:

- Empty strings can be stored where `null`/undefined is intended.
- `priceCurrency` and SEO fields can drift if added later.
- No domain normalization.

Plan:

- Normalize admin product input in service.
- Convert empty `brandId` to null or omit.
- Convert empty optional strings to null if desired.
- Validate price >= 0.
- Validate stock status enum.
- Update SEO fields deliberately, not accidentally.

### P1: Missing Product Status And Visibility

Current state:

- Products are all visible if returned by public `/products`.

Risk:

- Draft, broken, duplicate, or incomplete parsed products appear publicly.

Plan:

- Add `status` field: `draft`, `published`, `hidden`, `archived`.
- Public API returns only `published`.
- Admin filters by status.
- Parser creates `draft` by default.

### P1: Sorting By `created` Maps To `id`

Current state:

- Admin product query maps `sortBy === 'created'` to `id` because Product has no `createdAt`.

Risk:

- Misleading sort.
- UUID does not reliably represent creation time.

Plan:

- Add `createdAt` and `updatedAt` to core models, at least `Product`, `Brand`, `Category`, `SourceProduct`.
- Replace id sort with `createdAt`.

### P1: No Automated Tests For Critical Flows

Current state:

- Build and lint are used, but no visible test coverage for admin/parser/product flows.

Risk:

- Regressions in parser, admin delete, brand merge, route behavior, DTO validation.

Plan:

- Add service tests for admin product create/update/delete.
- Add tests for brand merge transaction.
- Add parser unit test with saved HTML fixture.
- Add public API tests for product list/detail.

### P1: Parser Error Handling Is Too Loose

Current state:

- Parser catches errors and logs to in-memory/parser log service.
- Some parsing data is not validated before save.

Risk:

- Bad data can be saved without explicit failure.
- Parser logs can be lost on restart if in memory.

Plan:

- Persist parser runs and errors in DB.
- Add validation before product upsert: name, slug, category, price parse sanity.
- Mark queue item failed with error count rather than retrying blindly.

### P1: SourceProduct Storage Is Incomplete

Current state:

- Single import creates `SourceProduct` with empty `images` and `specifications`.
- Older `SourcesProductsService` has in-memory sourceProducts stub.

Risk:

- Supplier source data is not useful for comparison/debugging.
- In-memory service is not production-grade.

Plan:

- Remove or replace in-memory `SourcesProductsService` with Prisma-backed implementation.
- Store parsed raw supplier specs/images/description/price in `SourceProduct`.
- Add unique constraint on `[sourceId, externalId]` or `[sourceId, url]`.

### P2: Query Types Use `any`

Current state:

- `products.service.ts` uses `any` for Prisma where/orderBy.
- Backend lint shows unsafe warnings.

Risk:

- Lower type safety; harder refactors.

Plan:

- Use Prisma types like `Prisma.ProductWhereInput` and `Prisma.ProductOrderByWithRelationInput`.
- Fix lint warnings.

### P2: No Rate Limiting Or Request Hardening

Current state:

- No visible throttling or rate limits.

Risk:

- Public search/API and admin endpoints can be abused.

Plan:

- Add Nest throttler for public API and stricter admin limits.
- Add request body size limits.
- Add timeouts for parser fetch calls.

## Parser Weak Spots

### P0: Only One Production Parser Is Wired To Catalog Save

Current state:

- th-tool.by parser saves to catalog.
- Other parsers exist but do not appear integrated into the normalized save flow.

Risk:

- Adding suppliers will duplicate logic or create inconsistent data.

Plan:

- Define a common `ParsedSupplierProduct` interface.
- Build source-specific parsers that output this interface.
- Build one catalog import service that normalizes and saves.

### P1: Parser Is Tightly Coupled To HTML Selectors

Current state:

- Selectors like `.product__top-brand-name`, `.p-images__slider-item`, `.features-two-val__block` are hardcoded.

Risk:

- Supplier redesign breaks parsing silently.

Plan:

- Add parser fixtures and tests.
- Add required-field checks.
- Add parser health metrics: success/fail counts per source.

### P1: Slug Collisions Are Not Handled Well

Current state:

- Product slug is generated from product name and used for upsert.

Risk:

- Different supplier products with same name can overwrite one product.
- Duplicate SKUs/models are not used for matching.

Plan:

- Use `SourceProduct` identity first.
- Build matching logic by source external id, SKU, model, brand, normalized name.
- Generate unique product slug with suffix when needed.

### P1: Parser Can Overwrite Manual Edits

Current state:

- Parser update writes price, description, SKU, category, images.

Risk:

- Admin fixes can be lost after re-parse.

Plan:

- Add field-level override flags or split parsed data from curated product data.
- Keep automated updates to volatile fields only by default: price, stock, source link.
- Require admin confirmation for overwriting title/category/description/images.

## Frontend Weak Spots

### P0: Production Build Depends On Correct Node Version

Current state:

- Local Node `v21.5.0` breaks Nuxt/Vite build with `crypto.hash is not a function`.

Risk:

- Deploy/build instability.

Plan:

- Add `.nvmrc` or `.node-version` with supported Node version, recommended `22.12+` LTS/current-compatible.
- Add `engines.node` in `frontend/package.json`.
- Ensure CI/deploy uses the pinned version.

### P1: Admin UI Is Functional But Hard To Maintain

Current state:

- Admin Vue files have dense one-line templates/styles.
- Product modal is manually implemented in a long page file.

Risk:

- Changes become error-prone.
- Hard to add validation and reuse UI.

Plan:

- Extract shared admin components: `AdminCard`, `AdminNotice`, `AdminModal`, `AdminPageHeader`, `AdminTableRow`.
- Extract product form into `AdminProductForm.vue`.
- Extract brand/category forms similarly.
- Use consistent modal handling and body scroll lock helper/composable.

### P1: Admin Form Validation Is Minimal

Current state:

- Mostly HTML `required`; backend returns errors.

Risk:

- Poor admin UX and accidental bad data.

Plan:

- Add client-side validation for slug, price, required category, duplicate choices in merge.
- Show field-level errors.
- Disable submit while saving.
- Add optimistic/success state consistently.

### P1: Admin Token UX/Security Is Basic

Current state:

- Token entered on dashboard and stored in localStorage.

Risk:

- Child pages can be blank/error if token missing.
- Security concerns from localStorage.

Plan:

- Add admin layout/middleware that loads token and redirects/prompts when missing.
- Later replace token storage with httpOnly cookie login.

### P1: ISR Staleness After Admin Edits

Current state:

- Product pages use ISR for 86400 seconds.
- Admin edits do not invalidate cached product pages.

Risk:

- Public product page can show stale data for up to a day.

Plan:

- For MVP: reduce product ISR TTL to 1-6 hours if frequent edits.
- Better: add Nuxt cache invalidation route/hook after product update.
- Or keep product pages SSR until cache invalidation exists.

### P1: Catalog Loads A Second Large Product List For Facet Counts

Current state:

- `catalog.vue` fetches `/products?limit=200` for facet counts.

Risk:

- Inaccurate counts after >200 products.
- Extra load on API.

Plan:

- Add backend facets endpoint: category counts, brand counts, price range.
- Return counts based on current filters.

### P2: Product Card Price Defense Is Frontend-Only

Current state:

- Frontend falls back to `BYN` if currency is invalid.

Risk:

- Bad data remains in DB and APIs.

Plan:

- Add backend normalization/migration to fix existing bad `priceCurrency` values.
- Validate currency on write.

### P2: Accessibility Gaps In Custom Modals

Current state:

- Modal lacks focus trap, escape handling, ARIA attributes.

Risk:

- Poor keyboard/screen reader behavior.

Plan:

- Use Nuxt UI modal/dialog or implement focus trap.
- Add `role="dialog"`, `aria-modal="true"`, focus first field on open, close on Escape.

## Data Model Weak Spots

### P0: No Order/Checkout Models

Current state:

- Project is currently catalog/storefront, not a full internet shop.

Risk:

- Cannot accept orders yet.

Plan:

- Add MVP commerce models when ready: `Cart`, `Order`, `OrderItem`, `Customer`, `DeliveryMethod`, `PaymentMethod`.
- Decide whether checkout requires user accounts or guest checkout.

### P1: No Timestamps

Current state:

- Core models mostly lack `createdAt` and `updatedAt`.

Risk:

- Hard to audit imports, edits, freshness, sorting.

Plan:

- Add timestamps to `Product`, `Brand`, `Category`, `ProductImage`, `Source`, `SourceProduct`, parser logs/runs.

### P1: No SKU/Source Uniqueness Strategy

Current state:

- Product has optional `sku`, `model`; source product has `externalId` but no unique constraint.

Risk:

- Duplicate products and source links.

Plan:

- Add unique source identity: `[sourceId, externalId]` or `[sourceId, url]`.
- Add product matching service rather than name-only slug upsert.

### P1: No Product Publication Metadata

Current state:

- No `status`, `publishedAt`, `hiddenReason`.

Risk:

- Broken parsed products may be public.

Plan:

- Add product status and admin filters.
- Use `publishedAt` for public sorting and sitemap later.

## DevOps And Deployment Weak Spots

### P0: Runtime Version Is Not Pinned

Current state:

- Local Node version breaks frontend build.

Plan:

- Add root `.nvmrc` or per-app `.nvmrc`.
- Add package `engines`.
- Use the same Node version in CI and production.

### P1: No Visible Docker/Process Plan In Knowledge Base

Current state:

- Deployment recommendation exists, but process files are not established in this audit.

Plan:

- Add `docker-compose.prod.yml` or documented PM2 ecosystem.
- Include PostgreSQL backup routine.
- Add reverse proxy config example for Nginx/Caddy.

### P1: No Database Backup Strategy

Risk:

- Parsed and manually curated catalog can be lost.

Plan:

- Daily PostgreSQL dumps.
- Store backups off-server.
- Test restore procedure.

### P1: No Observability

Current state:

- Console logs and in-memory parser errors.

Plan:

- Add structured logs.
- Persist parser runs/errors.
- Add health endpoint.
- Monitor uptime and disk space.

## Recommended Roadmap

### Phase 1: Production Safety Baseline

- Pin Node version for frontend build.
- Remove or guard public mutation endpoints.
- Add product `status` and hide non-published products from public API.
- Add timestamps to key models.
- Add DB backup routine.
- Normalize/fix existing invalid `priceCurrency` rows.
- Add pre-delete checks for categories and safer admin error messages.

### Phase 2: Parser And Data Quality

- Introduce a common parsed product interface.
- Split supplier raw data from curated product data.
- Add `SourceProduct` unique constraints and store parsed images/specs.
- Prevent parser from overwriting admin-curated fields.
- Add parser fixtures and tests.
- Add persisted parser runs/errors.

### Phase 3: Image Storage

- Add S3/R2 storage service.
- Download and upload parsed images to first-party object storage.
- Add image metadata and hashing.
- Backfill existing product images from supplier URLs.
- Serve images through CDN.

### Phase 4: Admin Maintainability

- Extract admin UI components.
- Extract product/brand/category forms.
- Add reusable modal and scroll lock/focus trap.
- Add field-level validation and loading states.
- Add admin route guard/middleware UX.

### Phase 5: Storefront And Ecommerce

- Add cart and checkout requirements.
- Add order models and admin order page.
- Add customer/contact fields.
- Add delivery/payment flow.
- Add SEO sitemap and structured product data.
- Add product availability/source price freshness display.

### Phase 6: Performance And Search

- Add facets endpoint for catalog counts and price range.
- Add DB indexes for filters/search.
- Consider PostgreSQL full-text search or Meilisearch later.
- Add cache invalidation for ISR product pages after admin edits.

## Immediate Next Tasks

1. Add `.nvmrc` and `engines` for Node version.
2. Guard or remove public write endpoints.
3. Add product `status`, `createdAt`, and `updatedAt` migration.
4. Update public product queries to return only published products.
5. Add first parser fixture test for th-tool.by.
6. Add category delete pre-checks.
7. Plan object storage integration for parsed images.
