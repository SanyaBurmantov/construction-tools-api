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

- **Auth = accounts + an opaque session token** (`auth/`). `User` has a
  normalized unique `login` (an e-mail works as one), a `role`
  (`CUSTOMER` | `ADMIN`) and a `customerType` (`INDIVIDUAL` | `COMPANY`, the
  физ/юр лицо choice made at registration — a COMPANY must give
  `companyName`). `POST /auth/register` always mints a **CUSTOMER**: an ADMIN
  can only be created from `/admin/users`, so the storefront can never
  self-promote. Login issues a random 256-bit token stored in `UserSession` as
  a **SHA-256 hash** and sent back as `Authorization: Bearer` — a dump cannot
  be replayed, and deleting the row logs that device out immediately, which a
  JWT could not. That is why there is still no JWT and no `@nestjs/jwt`.
  Passwords are **scrypt** from `node:crypto` (`auth/password.util.ts`,
  parameters stored alongside each hash) — no native build step, so the
  `node:22-slim` images need no toolchain; bcrypt would.
  `AdminGuard` now accepts **either** an ADMIN session **or** the old
  `x-admin-token: $ADMIN_TOKEN` header, which stays the service-to-service
  path (the runbook/CI curl commands depend on it, and it is the rescue path
  when nobody can log in). A valid non-admin session gets **403**, not 401, so
  the UI keeps the login instead of bouncing to the sign-in screen.
  Side effects worth keeping: a password change or an admin disabling an
  account deletes that user's sessions on the spot; the last active admin
  cannot be demoted, disabled or deleted, and nobody can do any of it to
  themselves. `AuthModule` is `@Global()` on purpose — `AdminGuard` is
  instantiated in five modules, and that beats re-registering `AuthService` in
  each or importing AdminModule (circular).
  **Guarding the public surface** (checked when roles landed): every mutating
  endpoint outside `/auth` and `/account` is behind `AdminGuard`;
  `POST /orders`, `POST /products/:slug/reviews`, `POST /cart/validate` and
  `POST /promo-codes/validate` are public on purpose (guests order, review and
  re-price carts) and carry their own `@Throttle` — the promo one is 20/min
  because it answers "does this code exist". `GET /sources` returns
  `{id, name, code}` only: the supplier's `url` is internal, the same rule as
  supplier prices. The dead public `GET /source-products` (an in-memory array
  that always answered `[]`, shaped to hand out supplier URLs and costs) was
  removed rather than guarded. `GET /orders/:id` stays public by unguessable
  UUID — a guest needs the confirmation page — and projects out PII.
  **The first admin is created at boot** by `auth/admin-bootstrap.service.ts`
  when no active ADMIN exists: login `ADMIN_LOGIN` (default `admin`), password
  `ADMIN_PASSWORD` falling back to `ADMIN_TOKEN` so a deployment needs no new
  secret. It never touches an existing account — a changed password stays
  changed, and a deliberately deleted admin is not resurrected while another
  one is active.
- **API routing in prod**: Caddy serves `/api/*` → strips `/api` → `backend:8000`;
  everything else → `frontend:3000`. Client calls use base `/api`
  (`NUXT_PUBLIC_API_BASE`); SSR calls go through the Nuxt server route
  `frontend/server/api/[...path].ts` → `API_BASE_SERVER` (`http://backend:8000`).
- **Frontend ISR**: `nuxt.config.ts` `routeRules` — home/catalog `isr: 300`,
  product/brand `isr: 900`, admin `ssr: false`. Note that Nitro's cache key is a
  hash of the **full URL including the query string**, so every filter
  combination on `/catalog` and every `?search=` on `/brand` is its own cache
  entry. Cached HTML is served cheaply; runtime
  is light. The build is the memory-heavy step.
- **Data model**: products are stored in two layers — `Product` (normalized
  storefront card) and `SourceProduct` (raw supplier snapshot, identity
  `@@unique([sourceId, url])`). See the parsing docs below.
- **Reliability guarantees worth not undoing.** `fetchWithTimeout` already
  retries transient failures (timeouts, 429, 5xx) with backoff and `Retry-After`,
  and deliberately does **not** retry 404/403. Parsers throw `ParserHttpError`
  so a 404/410 is distinguishable: it means the supplier delisted the product,
  and `OffersService.delistOffer()` withdraws the offer, re-prices from whoever
  still carries it, and hides the product only when no live offer remains
  (never touching an `ARCHIVED`/`HIDDEN` decision a human made). Batches report
  per-run counters (`BatchResult`), which is what lets `getHealth()` call a job
  `ERROR` when most of a run failed — a run that fails on every URL still
  *finishes*, so staleness alone reported the classic silent parser death as
  healthy. `ParserWatchdogCron` (:07/:37, off the parsing slots) is also what keeps the
  catalogue fresh: `QueueRecoveryService` requeues every `DONE` row older than
  `PARSER_REFRESH_AFTER_HOURS` (24) for **all** sources, keeping `visitedAt`,
  so never-seen URLs go first and then the stalest snapshots. That — not the
  monthly `revalidate` job — is what re-reads prices; `revalidate` resets the
  *whole* queue including deliberate `SKIPPED` rows, which is why it is a
  manual "after a parser fix" button. The watchdog also requeues
  `FAILED` rows with `attempts < PARSER_MAX_ATTEMPTS` older than
  `PARSER_RETRY_AFTER_MINUTES`, and alerts Telegram once per breakage — it
  remembers what it already reported so an unhealthy job does not re-alert every
  15 minutes.
- **Not every characteristic becomes a filter.** `shouldBeFilterable()`
  (`parser/spec-filterable.ts`) decides `Specification.filterable` when a spec
  first appears in a category. Parsers used to set it to `true` unconditionally,
  which turned "Штрихкод" (unique per product) and "Производитель" (a legal
  address) into catalogue facets. Identity/paperwork names are blocked by list,
  and any value over 60 characters is treated as prose. It is only the default:
  admins flip specs in `/admin/specifications`, and `auto-select` still applies
  the distinct-value heuristic over real data.
- **Product identity is the supplier offer, not `Product.slug`.** Parsers must
  save through `ProductIdentityService.save()` (`parser/product-identity.service.ts`),
  which resolves the product via `SourceProduct(sourceId, url)` and only mints a
  slug for genuinely new products (`-2`, `-3`… when the pretty one is taken).
  The old `product.upsert({ where: { slug } })` had two failure modes seen in
  production: two items whose names slugify the same **silently overwrote each
  other** (queue said DONE, catalogue gained nothing), and — because a nested
  `images: { create }` stops Prisma using `INSERT … ON CONFLICT` — two workers in
  one batch raced and the loser threw `Unique constraint failed … (slug)`. The
  same service wraps the `Brand` and `Specification` upserts, which raced for the
  same reason. Anything creating products from a parse goes through it.
- **Category identity is `Category.pathKey`, not `slug`.** `pathKey` is the full
  slug chain (`aksessuary/avtolampy/narva`); `slug` is only the public URL.
  Parsers must build the tree through `CategoryTreeService.upsertBranch()`
  (`parser/categories/`), never with `category.upsert({ where: { slug } })` —
  that keyed on the leaf name, so every branch ending in "Прочее" collapsed into
  one category and the first branch to parse won the parent. The slug still
  prefers the bare leaf (existing URLs don't move) and only falls back to
  `parent-leaf` → full chain → numbered when another branch already holds it.
  Anything that re-parents a category must update `pathKey` too, or the next
  parse recreates the row at its old position — see `category-merge.service.ts`.
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
- **A listed category always has something in it.** Nothing in the storefront
  may render a category whose count is 0 — it is a link to the "ничего не
  найдено" screen, not a choice. Two layers enforce it: `pruneUnlistable()`
  drops empty *and* admin-hidden branches from the tree and from a category
  page's children, and `GET /products` leaves a category out of
  `facets.categories` entirely instead of reporting `0`, so the subcategory
  strip beside the grid stays filter-aware (switch on `onSale` at the top level
  and only categories that actually have a discounted product remain).
- **Categories are curatable, identity is not.** `Category.sortOrder` /
  `isVisible` / `isFeatured` are admin presentation settings, editable per row
  in `/admin/categories` (plus `PATCH /admin/categories/order`, which renumbers
  a whole row of siblings in one transaction so two can't claim one slot).
  `sortOrder = 0` means "never placed" and sorts *after* curated rows, which
  keeps the old biggest-first order for the thousand categories no one has
  touched; `isVisible: false` hides a branch from the menu, the tree, the
  facets and search suggestions while leaving its URL working;
  `isFeatured` pins it into the home page grid. None of this touches `pathKey`,
  so the parsers keep upserting the same rows. Admin edits that *do* move a
  category (`parentId`, `slug`) rebuild `path`/`level`/`pathKey` for the whole
  subtree and leave the old slug behind as a `CategoryRedirect`.
  Frontend: one `components/ui/UiCategoryCard.vue` renders every "link to a
  category" (`tile` / `row` / `chip`) — home grid, catalogue, brand page — and
  `composables/useCategoryTree.ts` is the single tree fetch (one shared
  `useAsyncData` key for header, home and catalogue).
- **Storefront orders**: the storefront now asks for an account before
  checkout, while `POST /orders` itself still accepts a guest order (see
  "Checkout requires an account" below) — so the API contract and the runbook
  did not change. The cart lives client-side
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
- **The account's cart is backed up server-side** (`CartItem`,
  `cart/server-cart.service.ts`), while the **localStorage cart stays the one
  the UI renders and checkout submits** — a guest has only that, and a failed
  sync must cost nothing. Three rules keep the two from fighting:
  only `productId` + `quantity` are stored (**never a price** — a line is
  re-priced from `Product` on every read, so a stored row cannot resurrect an
  old price); on **sign-in** the local cart is *merged* up and the merged cart
  replaces the local lines (`POST /cart/merge`), which is what makes "pick
  things as a guest, then log in" keep everything and what restores a cart on
  a new device; on every **later change** the local cart is pushed up whole
  (`PUT /cart`, debounced 800 ms — last write wins, because a cart is edited
  on one device at a time). The merge keeps the **larger quantity, never the
  sum**: summing looks right until the same cart syncs twice (two tabs, a
  re-login, an offline edit) and every line silently doubles. Unpublished or
  deleted products are dropped from the stored cart as it is served (and the
  row deleted), `POST /orders` empties it once an order from that account is
  committed, and `CartCleanupCron` drops carts untouched for `CART_TTL_DAYS`
  (90). Frontend: `plugins/cart-sync.client.ts` + `composables/useServerCart.ts`;
  `stores/cart.ts` gains only `applyServerCart()`.
  `POST /cart/validate` stays **public** — a guest cart needs re-pricing too —
  while `GET/PUT/DELETE /cart` and `POST /cart/merge` are `AuthGuard`-only and
  always scoped to the session's `userId`.
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
  under `/admin/promo-codes`. `listAvailable()` is what the account's
  «Доступные промокоды» section lists: active, in-window, not exhausted and
  `isPublic` — turn that flag off for a code meant for one person and it keeps
  working while no longer being advertised to everyone who signs in. The
  exhausted check is done in JS because Prisma cannot compare two columns
  (`usedCount >= maxUses`) in a `where`, and `usedCount`/`maxUses` never leave
  the admin API.
- **Reviews**: guest reviews (`reviews/` module) via
  `POST /products/:slug/reviews` always land in `PENDING`; only approved ones are
  returned by `GET /products/:slug/reviews` and counted into the denormalized
  `Product.ratingAvg` / `ratingCount`, which is recomputed on every moderation
  action. Moderation: `/admin/reviews`. The route runs under
  `OptionalAuthGuard`: with a session the review is linked to the account and
  gets `isVerifiedPurchase` when that account has a **non-cancelled order
  containing the product** — a snapshot taken once at submission, never a live
  lookup, so later order changes cannot rewrite history. The public projection
  exposes the flag but never the account.
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
  review. Loosen the constants in `reviews.service.ts` if that shows up — and
  note that a **signed-in** author sidesteps those rules entirely: an account
  is a better identity than an IP, so for it the per-IP limits are replaced by
  "one review per product per account" (no time window: a second one is an
  edit, not a new opinion). Honeypot and duplicate-text still apply to
  everyone.
- **Frontend design system**: tokens in `app/assets/scss/tokens.scss` (semantic
  layer + dark mode); primitives in `app/components/ui/*` (`UiButton`, `UiInput`,
  `UiModal`, `UiTable`, `UiPrice`, `UiRating`, …). Components read tokens, never
  raw hex. `app/assets/scss/main.scss` keeps aliases for the pre-token variable
  names. Toasts: `useToast()` + the single `<UiToaster>` in the layout.
- **Guest lists**: cart, wishlist (`stores/wishlist.ts`) and comparison
  (`stores/compare.ts`, max 4 items) are all localStorage-backed and rehydrated
  by `plugins/cart.client.ts`. Pages `/favorites` and `/compare` are `ssr: false`.
  For a signed-in account both lists are backed up server-side exactly like the
  cart (`UserListItem` + `lists/`, one table with a `kind` because the two
  features differ only in the cap): merge on sign-in, replace on change,
  `plugins/lists-sync.client.ts`. Merging a **full** comparison keeps the four
  already stored rather than the newly arrived ones — signing in must not
  reshuffle the table someone is looking at. `LIST_TTL_DAYS` (365) bounds it.
- **Admin UI**: one shell in `app/layouts/admin.vue` — a single auth gate plus
  the sidebar. The gate is a **login + password form** for an ADMIN account
  (`useAuth().login()`, then `GET /admin/stats`), not the old `ADMIN_TOKEN`
  field; a signed-in non-admin gets the "нет прав" screen instead of the form.
  Admin pages just set `definePageMeta({ layout: 'admin' })` and can assume the
  session is valid; do **not** re-add per-page token forms. `useAdminApi()`
  sends the session as `Authorization: Bearer` and is otherwise unchanged, so
  every admin page kept working. Accounts live in `/admin/users`:
  `users/index.vue` lists and creates them, `users/[id].vue` is one account —
  profile, figures, **current orders with an inline status select** and the
  finished ones in a table (`GET /admin/users/:id` returns all of it). The
  admin order list and detail also show which account placed an order, linking
  back to that page; a guest order says so.
- **Admin audit trail** (`audit/`, `AdminActionLog`, `/admin/audit`). Worth
  having only now that admins are accounts — under the shared token there was
  no "who". `AdminActionLogInterceptor` is registered **globally** (admin
  routes live in six controllers across four modules) and records a request
  when it is mutating **and** in admin scope: an ADMIN session, the
  `x-admin-token` header, or a path under `/admin` — that last one is what
  also captures attempts the guard rejected, which is half the point of an
  audit. Reads are not logged, or the log would be dashboard polling. Bodies
  are stored with `password`/`token`/`secret`/`authorization` replaced by
  `[redacted]`, long arrays summarised and the whole thing truncated at 4 KB:
  it is evidence of what changed, not a replayable payload. A failed audit
  write is logged and swallowed — it must never turn a successful admin action
  into an error. `ADMIN_LOG_TTL_DAYS` (180) bounds the table.
- **"Откуда спаршен" is admin-only, and visible everywhere a product is**
  (`components/admin/productSourceNote.vue` + `composables/useProductSources.ts`):
  the storefront product page (banner above everything), catalogue cards and
  rows, the admin product list and an order's lines. The data comes from
  `GET /admin/products/sources?ids=…` behind `AdminGuard`, so a regular
  visitor cannot obtain supplier URLs or our costs even though the same
  storefront component renders them for an admin — and for a non-admin the
  request is never fired. Ids are **batched on a 50 ms tick** through one
  shared cache, so a 24-card grid is one request, and a product with no offers
  is cached as an empty answer instead of being re-requested forever.
- **Storefront accounts**: `composables/useAuth.ts` is the single session
  (token in localStorage next to the guest cart, restored by
  `plugins/auth.client.ts`). Pages `/login`, `/register` and `/account` are
  `ssr: false` — there is nothing to render on the server. The header shows the
  account action (or "Войти") and, **for an ADMIN only, a link to the admin
  panel**; both are inside `<ClientOnly>` because the session is client-side.
- **Личный кабинет** (`/account`, four sections in one page, the open one kept
  in `?tab=`): *общая информация* (figures + profile + last order), *история
  заказов* (status filter, paging, expandable composition, «повторить заказ»),
  *промокоды*, *настройки* (profile, password, "выйти на всех устройствах").
  Settings also closes the account: `DELETE /auth/me` takes the password
  (a session could be a borrowed laptop), cascades sessions / stored cart /
  stored lists away and **keeps orders and reviews** with their link nulled —
  the shop's records and other customers' reading material are not the
  account's to erase. An ADMIN is refused there on purpose: removing an
  administrator belongs in `/admin/users`, which already protects the last one.
  Read side is `GET /account/summary|orders|orders/:id|promo-codes`
  (`account/` module, `AuthGuard`, every query scoped to the session's
  `userId` — the API never takes a user id from the client); writes stay on
  `/auth/me`. Someone else's order id is a **404, not a 403** — a 403 would
  confirm the order exists. «Повторить заказ» re-adds the order's lines from
  the *snapshot* and the cart's own `POST /cart/validate` re-prices them, so an
  old price can never come back silently.
- **Checkout requires an account, browsing does not.** `POST /orders` runs
  under `OptionalAuthGuard`: with a session it stamps `Order.userId` (that
  link is the **only** thing that puts an order in «История заказов» — orders
  are deliberately never matched to an account by phone or e-mail afterwards,
  or anyone could register with someone else's phone and read their orders),
  without one it is still a guest order, which is what keeps the runbook and
  the existing API contract working. The gate is on the storefront:
  `useCheckoutAuth().ensureAuthenticated()` sends a guest from the cart to
  `/login?redirect=/checkout&reason=checkout`, and the login/register screens
  render the reason from `AUTH_REASONS` and return to `redirect` afterwards.
  The cart survives the detour because it lives in localStorage — nothing is
  re-fetched or merged. Checkout prefills name/phone/e-mail from the profile,
  but only into blank fields, so a different recipient typed for one order is
  never overwritten.

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
schedule, writing health to `ParserRuntimeStatus` (exposed at
`GET /health/parser`).

**All parser configuration is runtime, not deploy-time.** `ParserSettingsService`
(`parser/parser-settings.service.ts`) resolves every knob as *DB row → env var →
code default*, and the admin writes the rows via `PATCH /admin/parser/cron` and
`PATCH /admin/parser/sources/:code`:

| Setting | DB key | env fallback |
| --- | --- | --- |
| global switch | `cron.enabled` | `PARSER_CRON_ENABLED` |
| per-source switch | `cron.<code>.enabled` | `<SOURCE>_CRON_ENABLED` |
| batch size | `cron.<code>.batchLimit` | `<SOURCE>_CRON_BATCH_LIMIT` |
| request delay | `parser.<code>.requestDelayMs` | `<SOURCE>_REQUEST_DELAY_MS` |
| crawl page cap | `parser.<code>.maxPages` | `<SOURCE>_DISCOVERY_MAX_PAGES` |
| categories per run | `cron.<code>.categoryBatchLimit` | `<SOURCE>_CATEGORY_BATCH_LIMIT` |
| category filters | `parser.<code>.category{Include,Exclude}` | `<SOURCE>_CATEGORY_*_REGEX` |

A source runs only when the global switch **and** its own switch are on. Parsers
must read these through the service — **never** `process.env` at module load,
which is what made the delay and the filters need a restart. Regexes are
validated on write: a broken one would throw on every product. Code-level filter
defaults live in `parser/parser-defaults.ts` (a dependency-free module, so the
registry and the parsers can both import them). `PARSER_SOURCES` is the registry
the admin UI iterates; a new supplier has to be added there too.

**Throughput is the thing people mistake for a hang.** One run every 30 min
means `batchLimit × 48` URLs a day. At the old default of 30 that is 1440/day
against a ~39k queue — a month, and indistinguishable from "остановилось" in the
UI. `/admin/parsing` shows the resulting ETA per source next to the switch.

**Category queue** (`parser/categories/category-queue.service.ts` +
`sites/th-tools-category.crawler.ts`). `ParserCategoryQueue` holds the supplier's
category URLs; processing one walks its `?page=N` pagination and pushes every
product URL it finds into the products queue, catching products the sitemap has
not listed yet. The crawler keys off the **URL shape** (`isThToolsProductUrl`),
not CSS classes, because the shop's theme markup churns. Switching a category
off in the admin also sets `SourceCategory.isEnabled = false` for that branch,
and the product parser skips (not fails) anything whose breadcrumb chain hits a
disabled row — so an admin toggle stops the import, not just the crawl.

Canonical, complete example to copy from: **`backend/src/parser/sites/7745-source.parser.ts`**
(service) + `7745.parser.ts` (pure parse fn) + `7745.cron.ts` (cron).

**tools.by specifics** (`tools.parser.ts` pure + `tools-by-source.parser.ts`
service + `tools-by.cron.ts`). Our supplier, catalogue export agreed with them —
their `robots.txt` is a blanket `Disallow: /` aimed at competitors, not at us.
Two things make this site different from the others:
- **No sitemap.xml.** `refreshSitemaps()` is a catalog crawl (`/catalog` →
  `/catalog/<id>/<id>` → `/product/<id>`), and it is the only way new products
  ever reach the queue. Bounded by `TOOLS_BY_DISCOVERY_MAX_PAGES`.
- **A product page embeds many other products** (recommendation carousels), each
  with its own `data-price` and gallery. So the price is read from the
  `.js-markup-price` block whose `data-product-id` matches the h1's, and images
  only from `.product__carousel`. "First price on the page" happens to work
  today and would silently put a recommended item's price on our card tomorrow.
Also: JSON-LD carries brand and availability but publishes `"price": "0.00"` —
never take the price from it. The h1 has a nested `.short-description` span that
belongs in the description, not the name; the last breadcrumb is a brand filter
(`?brand_id=…`), not a category; `Штрихкод` in the spec table becomes
`Product.barcode` and is what merges a tools.by offer with the same product from
th-tool.by. Photos come from `content.tools.by` at three sizes — deduplicated by
the size-stripped URL, largest kept.

**Which sources are real.** `th-tool.by`, `dukon.by` and `tools.by` are actual
suppliers.
**`7745.by` is not** — it was a sample site from the client and survives only as
the reference implementation of the parser shape. Its cron needs both
`PARSER_CRON_ENABLED` and `SUPPLIER_7745_CRON_ENABLED`, and both default to
`false`; keep it that way. Copy its structure, don't turn it on.

**th-tool.by specifics** (`th-tools.parser.ts` pure + `th-tools-source.parser.ts`
service, mirroring the 7745 split): it is a Webasyst shop with ~39k products on
flat one-segment URLs (`/<slug>/`), so `isThToolsProductUrl()` in
`sitemaps.service.ts` filters `/category/` and static pages out of the queue
*before* they cost an HTTP request. The page exposes `Штрихкод` in its spec
table — that becomes `Product.barcode`, which is the only signal besides
brand+sku that auto-merges duplicates, so don't drop it. Availability comes from
`[itemprop="availability"]`, and the gallery serves every photo at three sizes
(`.750x0` / `.970` / `.0x600`), deduplicated by the size-stripped URL. The
supplier also carries car accessories, bikes, garden and toiletries;
`TH_TOOLS_CATEGORY_EXCLUDE_REGEX` drops those while deliberately keeping
`Аксессуары / Измерительные приборы` and `Аксессуары / Спецодежда, защита`
(welding masks and PPE live there). The regexes are unit-tested in
`th-tools-category-filter.spec.ts` — a typo there silently empties the catalogue.

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
