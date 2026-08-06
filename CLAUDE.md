# CLAUDE.md

Guidance for working in this repository. Read this first.

## What this project is

Construction-tools catalog. It continuously parses products from supplier sites,
normalizes them into a shared catalog shape, and serves a public storefront.

- **backend/** — NestJS 11 API (TypeScript), Prisma 5 + PostgreSQL, the parsers.
- **frontend/** — Nuxt 4 (Vue 3, Vuetify + Nuxt UI), SSR with ISR/SWR route rules.
- **deploy/**, `docker-compose*.yml`, `deploy-prod.sh` — Docker deploy (db + backend + frontend + Caddy).

## Hard requirements

- **Node ≥ 22** (`.nvmrc` = 22.12.0). The Nuxt build fails on Node < 22 with
  `crypto.hash is not a function`. Docker images use `node:22-bookworm-slim`.
- PostgreSQL 15.

## Commands

Backend (`cd backend`):
- `npm run start:dev` — watch mode (needs a running DB; `npm run start:db-docker` starts one).
- `npm run build` — `nest build`.
- `npm run lint` — ESLint (prettier rules are enforced as errors; `npm run lint -- --fix`).
- `npm test` — Jest; `npm test -- --runInBand` for the parser specs.
- Prisma: `npx prisma migrate dev --name <change>` (dev), `npx prisma migrate deploy` (prod), `npx prisma generate`.

Frontend (`cd frontend`):
- `npm run dev` / `npm run build` / `npm run lint`.

Dev stack: `docker compose up` (root). Prod: see the `deploy-prod` skill.

## Architecture notes

- **Auth**: admin endpoints are guarded by `AdminGuard`, which checks the
  `x-admin-token` header against `ADMIN_TOKEN`. There is **no JWT** — the
  `@nestjs/jwt` / `passport-jwt` deps and `JWT_SECRET` env are dead code.
- **API routing in prod**: Caddy serves `/api/*` → strips `/api` → `backend:8000`;
  everything else → `frontend:3000`. Client calls use base `/api`
  (`NUXT_PUBLIC_API_BASE`); SSR calls go through the Nuxt server route
  `frontend/server/api/[...path].ts` → `API_BASE_SERVER` (`http://backend:8000`).
- **Frontend ISR**: `nuxt.config.ts` `routeRules` — home/catalog `isr: 300`,
  product `isr: 900`, admin `ssr: false`. Cached HTML is served cheaply; runtime
  is light. The build is the memory-heavy step.
- **Data model**: products are stored in two layers — `Product` (normalized
  storefront card) and `SourceProduct` (raw supplier snapshot, identity
  `@@unique([sourceId, url])`). See the parsing docs below.
- **Catalog browsing**: categories are a tree (parsers build it from supplier
  breadcrumbs; products attach to leaves). Public API: `GET /categories/tree`
  (aggregated counts, empty branches pruned), `GET /categories/:slug`
  (ancestors + children for a category page), `GET /brands/:slug/categories`.
  `GET /products` filters by `categorySlug`/`categoryId` **including the whole
  subtree**, supports comma-separated `brandId`, `inStock`, `onSale`, and returns
  filter-aware facets (each dimension excluded from its own counts) plus
  `facets.priceRange`. `sortBy` accepts `name|price|rating|createdAt|updatedAt`
  — note that Prisma only allows the `nulls: 'last'` option on **nullable**
  columns, so it is applied to `priceValue`/`ratingAvg` only. Frontend:
  `/catalog` + `/catalog/<category-slug>` pages share
  `components/catalog/CatalogView.vue`; filters live in query params
  (`brands`, `source`, `priceMin/Max`, `inStock`, `onSale`, `sort`, `page`).
- **Storefront orders**: guest checkout (no accounts). The cart lives client-side
  (Pinia `stores/cart.ts`, persisted to `localStorage`); `POST /orders`
  (`orders/` module) re-prices every line from the DB (never trusts the client),
  validates published/priced products, computes delivery cost, applies any promo
  code **server-side**, and snapshots product name/slug/image/price into
  `OrderItem`. Admin manages orders via `GET /admin/orders`,
  `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status`.
  Delivery costs are env-tunable (`DELIVERY_COST_COURIER`, `DELIVERY_COST_POST`).
- **Cart is client-side, prices are not.** The cart lives in `localStorage` and
  stores the price captured when an item was added, but supplier prices are
  re-parsed daily — so a restored cart drifts. `POST /cart/validate` (`cart/`
  module) re-prices a cart against the DB and flags each line
  (`price_changed` / `unavailable` / `price_missing` / `out_of_stock`); the cart
  and checkout screens call it on mount and render `components/cart/cartIssues.vue`.
  As a backstop, `POST /orders` accepts `expectedItemsTotal` and answers **409**
  when it no longer matches, so an order can never quietly cost more than the
  cart the customer saw. The frontend keys off the 409 status — the shared
  exception filter strips extra fields from the error body.
  Note: a server-side cart was considered and rejected — without accounts it
  buys no cross-device continuity, only a cookie, extra tables and a TTL cron.
  Revisit it if/when accounts land.
- **Order notifications**: `POST /orders` posts a summary to Telegram
  (`notifications/telegram.service.ts`). Enabled only when **both**
  `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set; otherwise it logs a
  warning at startup and no-ops. The send is fire-and-forget **with an explicit
  `.catch()`** — the order is already committed at that point, so a Telegram
  outage must never fail the request or crash the process on an unhandled
  rejection. Customer-supplied text is HTML-escaped (the message uses
  `parse_mode: HTML`). `PUBLIC_ORIGIN` adds a deep link to the order in admin.
- **One product, many supplier offers** (`offers/`). `Product` is the canonical
  card; `SourceProduct` rows hanging off it are competing supplier offers.
  Matching (`product-matching.ts`, pure and unit-tested) ranks signals
  barcode > brand+sku > brand+model > similar name. An article number only
  identifies together with its brand, and a name match across *different*
  brands is always rejected. **Only barcode and brand+sku auto-merge** — weaker
  signals go to `/admin/duplicates` for a human, because an incorrect merge is
  expensive to unpick.
  `ProductMergeService.merge()` moves offers, images, specs, reviews, price
  history and order lines onto the survivor inside one transaction. Moving
  `Review` and `PriceHistory` is **mandatory, not tidiness**: both cascade on
  delete, so skipping them would silently destroy customer reviews. The merged
  slug becomes a `ProductRedirect`, and the product page turns that into a 301.
  **`Product.costPrice` comes from the cheapest offer**, not from whichever
  parser ran last — in-stock offers outrank a cheaper unavailable one. Parsers
  call `offers.onProductParsed(productId)` *after* saving their SourceProduct.
  Public API exposes only `offers: { count, inStockCount }`. Supplier URLs and
  our costs must never reach the storefront — they are admin-only
  (`GET /admin/offers/product/:id`).
- **Pricing / margin engine** (`pricing/`). Supplier cost lives in
  `Product.costPrice`; the storefront price is derived from it by `PricingRule`
  (percent and/or flat markup, minimum absolute margin, cost bands, rounding
  `.90/.99/integer/tens`, priority). The most specific active rule wins —
  SOURCE > BRAND > CATEGORY > GLOBAL — and a CATEGORY rule covers the whole
  subtree. Pure arithmetic sits in `pricing.calculator.ts` with no DB access,
  so it is directly testable.
  **Invariant: `PricingService` is the sole owner of `Product.priceValue` and
  `oldPrice`.** Parsers must NOT write either in their upsert `update` branch —
  they call `pricing.applyCost(productId, cost)` after the upsert instead.
  Writing the price in the parser would clobber MANUAL prices, and writing
  `costPrice` there would defeat the spike guard, which compares old cost to new.
  Guards worth knowing: a cost change beyond
  `PRICING_SPIKE_THRESHOLD_PERCENT` (default 50) is treated as a supplier typo —
  the product keeps its price, gets `priceReviewNeeded`, and the rejected cost
  waits in `PriceHistory` until an admin accepts or rejects it in
  `/admin/pricing`. `pricingMode = MANUAL` pins the price: parsing records the
  cost (so margin stays honest) but never touches the price. A supplier's own
  "was" price is marked up by the same rule, and cleared when the supplier's
  discount ends. Every change is written to `PriceHistory`.
  Adoption on an existing catalogue: `POST /admin/pricing/backfill-cost` adopts
  current storefront prices as costs, then run the recalculation.
- **Discounts**: `Product.oldPrice` above `priceValue` marks a product as
  discounted — that's what `onSale` and the `/sales` page filter on.
  `PromoCode` (`promo/` module) is validated at `POST /promo-codes/validate` for
  the checkout preview and **re-evaluated** inside `POST /orders`, so an
  exhausted or expired code is still rejected at order time. Admin CRUD lives
  under `/admin/promo-codes`.
- **Reviews**: guest reviews (`reviews/` module) via
  `POST /products/:slug/reviews` always land in `PENDING`; only approved ones are
  returned by `GET /products/:slug/reviews` and counted into the denormalized
  `Product.ratingAvg` / `ratingCount`, which is recomputed on every moderation
  action. Moderation: `/admin/reviews`.
- **Review spam defence**, cheapest check first:
  1. a `website` honeypot field (off-screen in the form, never shown);
  2. `@Throttle` on the POST route — 5/hour per IP, far stricter than the
     global 120/min;
  3. one review per product per IP per 24h, and 5 per IP per 24h overall;
  4. identical text on the same product within 24h.
  Honeypot and duplicate-text hits return the **normal success response** on
  purpose — telling a bot it was caught only teaches it what to change. Only
  the per-IP limits answer with an error, since a real person can hit those.
  IPs are stored as a salted SHA-256 (`Review.ipHash`, salt from
  `REVIEW_IP_SALT`, falling back to `ADMIN_TOKEN`) — never in the clear.
  Trade-off to keep in mind: behind carrier-grade NAT several customers share
  one address, so the per-IP-per-product rule can reject a genuine second
  review. Loosen the constants in `reviews.service.ts` if that shows up.
- **Frontend design system**: tokens in `app/assets/scss/tokens.scss` (semantic
  layer + dark mode); primitives in `app/components/ui/*` (`UiButton`, `UiInput`,
  `UiModal`, `UiTable`, `UiPrice`, `UiRating`, …). Components read tokens, never
  raw hex. `app/assets/scss/main.scss` keeps aliases for the pre-token variable
  names. Toasts: `useToast()` + the single `<UiToaster>` in the layout.
- **Guest lists**: cart, wishlist (`stores/wishlist.ts`) and comparison
  (`stores/compare.ts`, max 4 items) are all localStorage-backed and rehydrated
  by `plugins/cart.client.ts`. Pages `/favorites` and `/compare` are `ssr: false`.
- **Admin UI**: one shell in `app/layouts/admin.vue` — a single auth gate
  (validates `ADMIN_TOKEN` against `GET /admin/stats`) plus the sidebar. Admin
  pages just set `definePageMeta({ layout: 'admin' })` and can assume the token
  is valid; do **not** re-add per-page token forms.

## Database / migrations

- Schema is in `backend/prisma/schema.prisma`. Migrations in
  `backend/prisma/migrations`, starting from a squashed baseline
  `00000000000000_init`. The original pre-baseline migrations are archived in
  `backend/prisma/_migrations_archive_pre_baseline/` and are **not** applied.
- Prod containers run `prisma migrate deploy` on start (backend Dockerfile CMD).
- Add schema changes as new migrations and commit them. Never re-introduce
  `prisma db push` for prod.

## Parsing (the core of this project)

The full flow and the step-by-step playbook for adding a new supplier live in:
- `.claude/skills/add-parser/SKILL.md` — **how to add a new parser** (main skill).
- `.claude/skills/parser-ops/SKILL.md` — run / debug / monitor parsers.
- `SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md` — field-by-field normalization rules.

One-paragraph map: a per-source **queue model** (`Sitemaps<Source>`) holds product
URLs with a `status`. `refreshSitemaps()` fills it from the site's sitemap.xml;
`processSitemapsBatch()` pops `PENDING` rows and calls `parseProductUrl()`, which
fetches HTML, runs a pure `parse<Source>(html)` function (cheerio + JSON-LD),
upserts `Product` + images + specs + `SourceProduct`, and marks the row
`DONE` / `SKIPPED` / `FAILED`. Crons in `sites/<source>.cron.ts` drive this on a
schedule, gated by env flags, writing health to `ParserRuntimeStatus`
(exposed at `GET /health/parser`).

Canonical, complete example to copy from: **`backend/src/parser/sites/7745-source.parser.ts`**
(service) + `7745.parser.ts` (pure parse fn) + `7745.cron.ts` (cron).

## Conventions

- Match the surrounding NestJS style: `@Injectable()` services, constructor DI,
  Prisma via `PrismaService`. Pure HTML→data functions are kept separate from the
  DB-writing service and unit-tested against fixtures in `sites/fixtures/`.
- Keep parser HTTP polite: real user-agent, request delay, batch ≤ 30, concurrency 1.
- Slugs via `common/utils/generate-slug.ts`; bounded concurrency via
  `common/utils/run-with-concurrency.ts`.

## Don't

- Don't commit `.env` / `.env.prod` (gitignored) or build artifacts
  (`backend/dist`, `frontend/.output`, `frontend/.nuxt`).
- Don't run `npm run build` for the frontend on Node < 22.
- Don't overwrite manual `HIDDEN` / `ARCHIVED` product statuses on re-parse.
