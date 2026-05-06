# Frontend Developer Notes

Nuxt 4 frontend for the construction tools catalog and admin UI. This document is written for future developers and coding agents working inside `frontend/`.

## Stack

- Nuxt 4.
- Vue 3 Composition API.
- SCSS.
- SSR/Nitro node server in production.
- Backend API is proxied/configured through runtime config.

## Commands

Run from `frontend/`:

```bash
npm install
npm run dev
npm run lint
npm run build
```

Use Node `22.12.0+`. Nuxt/Vite build can fail on older Node with `crypto.hash is not a function`.

## Runtime Config

Important env/config behavior:

- Browser requests use `NUXT_PUBLIC_API_BASE`.
- Server-side requests use `API_BASE_SERVER`.
- In production Docker, frontend uses `API_BASE_SERVER=http://backend:8000` and `NUXT_PUBLIC_API_BASE=/api`.

## Main Pages

- `app/pages/index.vue`: homepage with hero and latest published product rail.
- `app/pages/catalog.vue`: public product catalog with filters and pagination.
- `app/pages/product/[slug].vue`: public product detail page.
- `app/pages/admin.vue` and `app/pages/admin/index.vue`: admin shell/dashboard.
- `app/pages/admin/products.vue`: product management.
- `app/pages/admin/categories.vue`: category/source-category mapping.
- `app/pages/admin/brands.vue`: brand management.
- `app/pages/admin/parsing.vue`: parser queues, imports, runtime status, supplier quality summary.

## Main Components

- `app/components/product/productCatalogCard.vue`: product card used by homepage/catalog.
- `app/components/layout/header.vue`: site header/navigation.
- `app/components/layout/footer.vue`: site footer.
- `app/components/ui/*`: shared UI pieces.

## Public Catalog Behavior

Catalog data comes from `GET /products`.

Supported query params used by frontend:

- `search`
- `categoryId`
- `brandId`
- `sourceCode`, for example `dukon`
- `priceMin`
- `priceMax`
- `sort`, mapped to backend `sortBy` and `sortOrder`
- `page`

The catalog has facets for:

- brands;
- categories;
- suppliers/sources.

Use `/catalog?sourceCode=dukon` to inspect storefront-visible Dukon products.

## Homepage Behavior

Homepage product rail loads:

```text
GET /products?limit=8&sortBy=createdAt&sortOrder=desc
```

This means newly parsed and published supplier products appear on the homepage without old maintenance updates pushing stale records to the top.

## Product Visibility Assumption

Frontend only shows products returned by public backend endpoints. Public `/products` only returns `PUBLISHED` products.

Parser-created supplier products are expected to be `PUBLISHED` by backend parser code. If a product does not appear on frontend, check backend first:

- product `status`;
- source linkage in `SourceProduct`;
- images in `ProductImage`;
- parser errors/runtime status.

## Admin API Usage

Admin frontend uses `useAdminApi()` from `app/composables/useAdminApi.ts`.

Admin requests send `x-admin-token`. Token is loaded/stored client-side by the composable.

Parser admin page uses these endpoints:

- `/admin/queue`
- `/admin/queue/sitemaps`
- `/admin/queue/errors`
- `/admin/queue/runtime-status`
- `/admin/queue/health`
- `/admin/queue/supplier-summary`
- `/admin/queue/dukon`
- `/admin/queue/dukon/sitemaps`
- `/admin/sources`
- `/admin/source-products/import`

The parser page is the main operational screen after deployment.

## Design Notes

Current public-site direction is a practical marketplace/catalog UI inspired by sites like Kufar, Avito, 7745.by, and th-tools.by.

- Prefer neutral backgrounds, white cards, compact spacing, soft borders, and subtle shadows.
- Use blue as the primary action/search accent and yellow only as a small secondary marketplace accent.
- Avoid the old poster-like style: thick black borders, heavy offset shadows, oversized decorative shapes, and aggressive typography.
- Product cards should look like marketplace listing cards and must work with missing images and missing prices.
- Catalog UX should prioritize search, filters, source/brand/category facets, price filters, and pagination.
- Use responsive layouts for desktop and mobile.
- Preserve SSR-safe data loading via `useAsyncData` and runtime config.
- Avoid adding client-only assumptions unless necessary.

## Development Rules

- Keep page-level API types close to the page unless reused broadly.
- Prefer existing components and visual patterns.
- After frontend changes run `npm run lint`.
- Run `npm run build` under Node `22.12.0+` before production handoff.
- If backend API shape changes, update page-local types and affected UI states.

## Production Checklist

- Build with Node `22.12.0+`.
- Verify `/catalog` loads products.
- Verify `/catalog?sourceCode=dukon` filters Dukon products.
- Verify homepage product rail shows latest parsed products.
- Verify admin parsing page loads queue/runtime/supplier summary with a valid admin token.
