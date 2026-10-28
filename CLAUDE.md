# CLAUDE.md

Guidance for working in this repository. Read this first.

## What this project is

Construction-tools catalog. It continuously parses products from supplier sites,
normalizes them into a shared catalog shape, and serves a public storefront.

- **backend/** — NestJS 11 API (TypeScript), Prisma 5 + PostgreSQL, the parsers.
- **frontend/** — Nuxt 4 (Vue 3), SSR with ISR/SWR route rules. No UI library:
  the design system in `app/components/ui/*` + `assets/scss/tokens.scss` is the
  whole of it (see «Frontend design system» below).
- **deploy/**, `docker-compose*.yml`, `deploy-prod.sh` — Docker deploy (db + backend + frontend + Caddy).
  The prod box has 1.8 GB for all four containers, so backend/frontend/Caddy
  carry a `mem_limit`: without one the kernel's OOM killer picks the biggest
  resident process, which is Postgres — the one service whose death takes the
  whole site down. Capped, a runaway run kills its own container and `restart`
  brings it back with the database untouched.
  A heap OOM, though, once **hung** node at 100% CPU instead of ending it
  (13 h of 502s, container "Up (unhealthy)" — Docker never restarts an
  unhealthy container). Two guards now: `common/utils/memory-guard.ts` exits
  the API cleanly at 85% of the V8 heap (`NODE_OPTIONS=--max-old-space-size=512`,
  `MEMORY_GUARD_MAX_HEAP_RATIO`) and logs heap/rss every 15 min, and
  `deploy/watchdog.sh` restarts a container left unhealthy for ~6 min.
  **From outside**: `.github/workflows/uptime.yml` runs
  `deploy/uptime-check.sh` every 5 minutes on GitHub's runners (home page and
  catalogue must answer 200 *and* mention gost.by — a wrong DNS record answers
  200 too —, `/api/health/ready`, TLS certificate ≥ 14 days) and alerts the
  Telegram alerts topic on a change of state and hourly while down. Secrets
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, `TELEGRAM_ALERT_THREAD_ID`
  live in the GitHub repository settings.

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
  a **SHA-256 hash** — a dump cannot be replayed, and deleting the row logs
  that device out immediately, which a JWT could not. That is why there is
  still no JWT and no `@nestjs/jwt`.
  **The browser gets the token only as an HttpOnly cookie** (`sid`,
  `auth/session-cookie.ts`; audit/security.md #3): `SameSite=Lax`, host-only
  (no `Domain`), `Expires` = the `UserSession.expiresAt`, `Secure` in
  production (`AUTH_COOKIE_SECURE=true|false` overrides), and **`Path=/api`**
  — every browser API call is under `/api` (Caddy in prod, Nuxt's
  `server/api/[...path].ts` proxy in dev) and no page request is, so SSR never
  sees the cookie and cannot render per-user data into the cached, shared
  HTML. Don't widen it to `/`. The login/register body carries no token; a
  script that wants one sends `X-Auth-Transport: bearer` and gets it in the
  body (no cookie). Guards read `Authorization: Bearer` first, then the cookie;
  logout, logout-all and account deletion clear it, a dead cookie is cleared
  on the 401, and a password change keeps this device's session (and cookie)
  while ending the others. **CSRF**: a *cookie*-authenticated non-GET request
  (and login/register from a foreign Origin) must carry `X-Requested-With`
  or an Origin/Referer equal to `PUBLIC_ORIGIN`/`CORS_ORIGIN`/the request host
  (`X-Forwarded-Host` first), else 403 — `assertNotCrossSite()`. Bearer and
  `x-admin-token` callers are exempt: a browser never attaches those itself.
  The frontend sends `API_REQUEST_HEADERS` (`useAuth.ts`) on every API call.
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
  because it answers "does this code exist". `GET /sources` is **behind
  `AdminGuard`** and returns `{id, name, code}` only — the supplier's `url` is
  internal, the same rule as supplier prices, and *which supplier carries what*
  is internal too: the «Поставщик» facet in the catalogue filters is rendered
  for an ADMIN session alone (`CatalogView` fetches the list only then, never
  on the server — storefront HTML is cached and shared), and `?source=` in the
  URL is **ignored for everyone else** — hiding the facet while the parameter
  still filtered meant an admin's link could quietly show a customer one
  supplier's goods with nothing in the UI saying so. The API enforces it too:
  `GET /products` runs under `OptionalAuthGuard` and drops `sourceCode` unless
  the session is an ADMIN (it used to filter for anyone with curl). `GET /products` carries no
  `facets.sources` at all: counting it was one semi-join over `SourceProduct`
  per supplier on every listing *and* every client-side filter change (those
  are not cached), for numbers only an admin would ever see — so the admin
  facet lists the suppliers without counts. The dead public `GET /source-products` (an in-memory array
  that always answered `[]`, shaped to hand out supplier URLs and costs) was
  removed rather than guarded. `GET /orders/:id` stays public by unguessable
  UUID — a guest needs the confirmation page — and projects out PII.
  **The first admin is created at boot** by `auth/admin-bootstrap.service.ts`
  when no active ADMIN exists: login `ADMIN_LOGIN` (default `admin`), password
  `ADMIN_PASSWORD` or, when that is unset, the committed
  `INITIAL_ADMIN_PASSWORD` (`test-111`) — so the first sign-in is known in
  advance instead of having to be looked up in `.env.prod`. That is the
  trade-off on purpose: a known initial password, changed from inside
  `/admin/users` after the first login. `ADMIN_TOKEN` is **not** a password
  fallback any more; it is only the service header. The bootstrap never
  touches an existing account — a changed password stays changed, and a
  deliberately deleted admin is not resurrected while another one is active.
- **API routing in prod**: Caddy serves `/api/*` → strips `/api` → `backend:8000`;
  everything else → `frontend:3000`. Client calls use base `/api`
  (`NUXT_PUBLIC_API_BASE`); SSR calls go through the Nuxt server route
  `frontend/server/api/[...path].ts` → `API_BASE_SERVER` (`http://backend:8000`).
  SSR therefore reaches the backend from the frontend container's private
  address for every visitor; the global throttler skips private/loopback
  peers (`InternalAwareThrottlerGuard`) — they all shared one 120/min bucket,
  and a crawler pushed SSR into 429s rendered as 404s. Browser traffic comes
  through Caddy and is throttled by its real IP. The storefront treats a 429
  like a 5xx (`isApiUnavailable`).
- **Frontend ISR**: `nuxt.config.ts` `routeRules` — home `swr: 60`, catalog
  `swr: 30`, product/brand `swr: 900`, `/sales` `swr: 300`, the info pages
  (`/delivery`, `/about`, `/contacts`, `/garantiya`, `/usloviya`, `/privacy`)
  `swr: 3600`, admin `ssr: false`. Note that Nitro's cache key is a
  hash of the **full URL including the query string**, so every filter
  combination on `/catalog` and every `?search=` on `/brand` is its own cache
  entry. Cached HTML is served cheaply; runtime
  is light. The build is the memory-heavy step.
- **One URL per page: lowercase, no trailing slash** (`/catalog`, not
  `/catalog/`). `server/middleware/canonical-url.ts` 301s every other form
  (query kept; `/api`, `/_*`, files with an extension untouched), matching the
  canonicals and the sitemap — so write internal links without the slash.
  Manrope is self-hosted from `public/fonts/` (no Google Fonts, and the CSP in
  `deploy/Caddyfile` no longer allows it). That cache lives in the
  frontend's heap, and Nitro's stock production driver never evicts — a crawl
  over 52k products filled the 384 MB container until it was OOM-killed (502s
  while it restarted). `nitro.storage.cache` is therefore a **bounded LRU**
  (`server/storage/bounded-memory.ts`, 96 MB, `NUXT_CACHE_MAX_MB`); don't swap
  it back for the plain memory driver.
- **Data model**: products are stored in two layers — `Product` (normalized
  storefront card) and `SourceProduct` (raw supplier snapshot, identity
  `@@unique([sourceId, url])`). See the parsing docs below.
- **Reliability guarantees worth not undoing.** `fetchWithTimeout` already
  retries transient failures (timeouts, 429, 5xx) with backoff and `Retry-After`,
  and deliberately does **not** retry 404/403. Parsers throw `ParserHttpError`
  so a 404/410 is distinguishable: it means the supplier delisted the product,
  and `OffersService.delistOffer()` withdraws the offer, re-prices from whoever
  still carries it, and hides the product only when no live offer remains.
  A URL that is *skipped* (not a product page any more, a category since
  excluded or switched off) withdraws its offer the same way. **Who set a
  status is recorded** (`Product.statusSource`: `SYSTEM` | `ADMIN`): a delist
  hides only a SYSTEM status, and `OffersService.publishIfReady()` puts a
  SYSTEM `DRAFT`/`HIDDEN` product back on sale as soon as it has a live offer
  and a price — a supplier's brief 404 no longer hides a product forever, and
  nothing an admin decided is touched. A batch where most URLs were delisted
  is reported `ERROR` (a supplier 404ing everything would otherwise empty the
  catalogue while the failure rate stayed at zero). Batches report
  per-run counters (`BatchResult`), which is what lets `getHealth()` call a job
  `ERROR` when most of a run failed — a run that fails on every URL still
  *finishes*, so staleness alone reported the classic silent parser death as
  healthy. `ParserWatchdogCron` (:07/:37, off the parsing slots) is also what keeps the
  catalogue fresh: `QueueRecoveryService` requeues every `DONE` row older than
  `PARSER_REFRESH_AFTER_HOURS` (24) for **all** sources, keeping `visitedAt`,
  so never-seen URLs go first and then the stalest snapshots. That is what
  re-reads prices. It also requeues `SKIPPED` rows older than
  `PARSER_SKIPPED_RECHECK_DAYS` (7), so a relisted product or a loosened
  category filter comes back without anyone pressing a button, requeues
  `FAILED` rows with `attempts < PARSER_MAX_ATTEMPTS` older than
  `PARSER_RETRY_AFTER_MINUTES`, gives the ones that used up their attempts a fresh
  budget after `PARSER_FAILED_RECHECK_DAYS` (3) — an 11-day th-tool.by outage
  left 16k URLs FAILED for good otherwise — except a row that crashed the process, parks a `PENDING` row that used up its
  attempts without ever finishing (the URL that OOMs the process), and alerts
  Telegram once per breakage. **Everything runs on its own** — the monthly
  `revalidate` cron stays on purpose (it keeps `visitedAt`, so the re-read is
  still stalest-first); the rule for new work is "no step may require a human
  to press a button".
  Batches **claim** their rows (`claimQueueBatch`, `UPDATE … FOR UPDATE SKIP
  LOCKED` with `lastTriedAt` as a 60-minute lease), so two workers never parse
  the same offer; and all jobs of one source share one lock in
  `ParserJobsService` (concurrency 1 per supplier), including the synchronous
  `/admin/queue/*` buttons (`runExclusive`). The daily crawls are started with
  `runFromCron(…, { waitForLock: true })`: they queue behind a running batch
  instead of skipping the slot, queued jobs of one source run in arrival order
  (`isTurnOf`), and `/admin/parsing` shows a queued one as «Ждёт окончания батча». The daily `refresh` crons pass
  `waitForLock`, so a 300-product batch that is still running at 06:00 queues
  the catalogue crawl behind it instead of skipping it — otherwise discovery
  never ran, because the watchdog keeps the queue non-empty. Other cron slots
  still skip a busy source on purpose. The old mutating GET triggers
  (`/products-from-sitemap-initial`, `/sitemap-initial`) are gone. A run left
  `RUNNING` by a killed process is marked failed at boot, and a run `RUNNING`
  for over 6 h is reported `ERROR`. `fetchWithTimeout` reads the **body**
  inside the timeout too (it returns a buffered `Response`), and keeps the
  Telegram bot token out of its error messages.
- **Not every characteristic becomes a filter.** `shouldBeFilterable()`
  (`parser/spec-filterable.ts`) decides `Specification.filterable` when a spec
  first appears in a category. Parsers used to set it to `true` unconditionally,
  which turned "Штрихкод" (unique per product) and "Производитель" (a legal
  address) into catalogue facets. Identity/paperwork names are blocked by list,
  and any value over 60 characters is treated as prose. It is only the default:
  admins flip specs in `/admin/specifications` — a hand-made choice sets
  `Specification.filterableLocked`, and the nightly normalizer leaves locked
  rows alone (it used to flip admin choices back every night) — and
  `auto-select` still applies the distinct-value heuristic over real data. The same module has three tiers:
  **supplier paperwork** (`isSupplierPaperworkSpec`: «Поставщик»,
  «Импортер/Продавец», «Производитель», the supplier's «Код») is stripped from
  every **public** product payload by `publicSpecs()` — it stays in the DB and
  the admin API; **identity** (`isIdentitySpec`: + barcode, article, brand) can
  never be a filter, not even by hand; **weight/dimensions**
  (`isOffByDefaultSpec`) start out off and the nightly normalizer never turns
  them on, but an admin may. `publicSpecs()` also orders consumer properties
  first, because the card shows only the first three.
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
  `upsertBrand()` also refuses values that are not brands (`parser/brand-name.ts`:
  «запчасти…», «без товарного знака», «Измерители», «-»…) — the product gets
  no brand — including measurements and bare numbers («420 литров/мин»: dukon's
  compressors became brands because `findSpecValue(…, 'производитель')`
  matched «Производительность»; dukon now matches the spec *name*,
  `findBrandSpec`). `BrandCleanupService` removes such rows imported earlier
  (on boot, nightly at 04:17 and `POST /admin/parser/clean-brands`); brand identity is the slug, so case
  variants are already one row. A brand an admin **merged** away leaves a
  `BrandAlias(slug → survivor)` that `upsertBrand()` resolves first, or the
  next parse recreated it and pulled its products back.
  **Admin corrections survive the re-parse**: every parser-owned field an admin
  edits (`name`, `categoryId`, `brandId`, descriptions, SEO, sku/model/barcode)
  joins `Product.lockedFields`, which `save()` skips exactly like
  `aiLockedFields`. "Удалить" in the admin **archives** the product
  (`ARCHIVED`, `statusSource: ADMIN`): a hard delete cascaded away customer
  reviews and price history, and the next parse recreated the product anyway.
  A new product and a stub of its `SourceProduct` are created in one
  transaction, so a parse that fails later cannot leave an orphan that the
  retry duplicates as `slug-2`.
- **Category identity is `Category.pathKey`, not `slug`.** `pathKey` is the full
  slug chain (`aksessuary/avtolampy/narva`); `slug` is only the public URL.
  Parsers must build the tree through `CategoryTreeService.upsertBranch()`
  (`parser/categories/`), never with `category.upsert({ where: { slug } })` —
  that keyed on the leaf name, so every branch ending in "Прочее" collapsed into
  one category and the first branch to parse won the parent. The slug still
  prefers the bare leaf (existing URLs don't move) and only falls back to
  `parent-leaf` → full chain → numbered when another branch already holds it.
  Anything that re-parents, re-slugs or merges a category must go through
  `categories/category-path-alias.ts` (`rekeyCategory`, `moveCategoryAliases`):
  the new `pathKey` is written and the **old one is kept in
  `CategoryPathAlias`**, which `upsertBranch()` checks first — the supplier
  still spells the old breadcrumb chain, and without the alias the next parse
  recreated the branch at its old position and pulled its products back (the
  root cause of the «Двигатель» duplicates). An alias hit is never "repaired"
  back to the supplier's parent.
  **Same-named siblings are one category.** The nightly root merge re-keys moved
  children, so the parser kept re-creating the supplier branch and the next
  merge parked it beside the canonical one — prod grew six «Двигатель» under one
  parent (`…-dvigatel-2` … `-6`). Two guards now: `upsertBranch()` reuses an
  existing same-named child of the parent (at the root, after resolving the
  `taxonomy.ts` synonym) before creating anything, and `merge()` is **deep** —
  a child the target already has by name is merged into it, not re-parented.
  What was already duplicated is listed at `GET /admin/categories/duplicates`
  and folded per group (`POST …/duplicates/merge`, «Дубли» view in
  `/admin/categories`) — and, since the owner asked for it, **every night**
  by `CategoryDuplicatesCron` (04:47, ≤100 groups, same deep merge with
  aliases and 301s; a group whose copies differ in visibility is left for an
  admin). Not every `-N` slug is a duplicate: «DIN 7981» is a standard's
  number.
  The parsers' fallback «Неразобранные товары поставщиков»
  (`FALLBACK_CATEGORY_SLUG`) is created `isVisible: false`, so it is in no
  storefront listing; its URL and its products' URLs still work.
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
  subtree (old keys kept as aliases, see above) and leave the old slug behind
  as a `CategoryRedirect`.
  Frontend: one `components/ui/UiCategoryCard.vue` renders every "link to a
  category" (`tile` / `row` / `chip`) — home grid, catalogue, brand page — and
  `composables/useCategoryTree.ts` is the single tree fetch (one shared
  `useAsyncData` key for header, home and catalogue). That SSR fetch is
  **roots only** (`GET /categories/tree?depth=1`, trimmed to the fields drawn):
  it is embedded in every page's `__NUXT_DATA__`, and the full ~3k-node tree
  made /delivery 1.15 MB of HTML. The roots' children, drawn only in the closed
  catalogue menu / mobile drawer, come client-side from `useCategoryMenu()`
  (`depth=2`, on idle or intent). Counts are aggregated before the cut;
  without `depth` the endpoint still returns the full tree (the sitemap uses it).
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
  warning at startup and no-ops. Orders go to the forum topic `TELEGRAM_THREAD_ID`;
  parser alerts, new kinds of 5xx (`ErrorLogService`: one per failure per
  hour, ≤10/h) and the host watchdog go to `TELEGRAM_ALERT_THREAD_ID`
  (optionally another chat, `TELEGRAM_ALERT_CHAT_ID`). The send goes through `fetchWithTimeout` like
  every other outbound call (hard timeout, one retry, `Retry-After`) and is
  fire-and-forget **with an explicit `.catch()`** — the order is already
  committed at that point, so a Telegram outage must never fail the request,
  hang it, or crash the process on an unhandled rejection. `axios` is gone from
  the backend entirely; don't bring it back for one POST. Customer-supplied text is HTML-escaped (the message uses
  `parse_mode: HTML`). `PUBLIC_ORIGIN` adds a deep link to the order in admin.
- **E-mail** (`notifications/mail.service.ts`, nodemailer over the hosting
  SMTP — hoster.by for gost.by). Enabled only when `SMTP_HOST`, `SMTP_USER`
  and `SMTP_PASSWORD` are all set; like Telegram it **never throws** — a
  committed order or a created account must not fail on a mail outage.
  "Enabled" only means the variables are set, so the service logs in once at
  boot (`verify()`) and a failed login or send goes to the Telegram alerts
  topic (`notifyMailProblem`, at most hourly) — a wrong `SMTP_PASSWORD` once
  went unnoticed. `POST /orders` also mails the customer a confirmation
  (`buildCustomerOrderMail`) when an e-mail was given.
  `POST /orders` also mails `MAIL_ADMIN_TO` (`notifications/order-mail.ts`,
  Reply-To = the customer), composed inside the promise so even a builder
  throw is caught. **Registration needs an e-mail** (the field, or a login
  that is one) and sends a confirmation link
  (`auth/email-verification.service.ts`, `/verify-email?token=…`). The token
  is stored as SHA-256 in `EmailVerification`, bound to the address it was
  sent to, and voided by a profile e-mail change (which also resets
  `User.emailVerifiedAt`). Confirmation is **soft**: an unconfirmed account
  still signs in and orders — a letter in spam must not cost a sale; the
  account page nags and offers a resend (`POST /auth/verify-email/resend`,
  3/h).
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
  Customers' stored carts, wishlists and comparisons (also cascading) are
  moved too, a duplicate's MANUAL price, field locks and pending review are
  carried over (`mergedState()`), and auto-merge never folds away or into a
  product an admin hid or archived — the survivor is the one on sale with the
  most live offers.
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
  `oldPrice`.** `ProductIdentityService.save()` strips prices, `status` and the
  lock columns from whatever a parser passes, and creates a new product as
  `DRAFT` with no price — it is published by `publishIfReady()` once
  `applyCost` has priced it (it used to go live at the raw supplier cost). An
  admin typing a price makes the product `MANUAL` and writes `PriceHistory`.
  Rounding snaps to kopecks before rounding up (100 × 1.1 is
  110.00000000000001, which `Math.ceil` turned into 111); a CATEGORY rule
  covers the subtree by walking `parentId` (not `path`, which holds the
  parser's slugs); "recalculate all" re-reads the supplier's "was" price from
  the best offer instead of wiping every discount.
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
  exhausted or expired code is still rejected at order time. The use is
  claimed with a conditional `UPDATE … WHERE "usedCount" < "maxUses"` inside
  the order transaction (the check alone let N parallel checkouts spend a
  single-use code N times), `POST /orders` has its own `@Throttle` (10/min),
  and cancelling an order gives the use back. Order status moves forward only
  (cancellation allowed until it ends; DELIVERED/CANCELLED are final) —
  enforced by `canMoveOrder()`, not just the admin UI. Admin CRUD lives
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
  layer; light only — the never-enabled dark theme was removed); primitives in `app/components/ui/*` (`UiButton`, `UiInput`,
  `UiModal`, `UiTable`, `UiPrice`, `UiRating`, …). Components read tokens, never
  raw hex. **It is the only UI layer** — Vuetify, Nuxt UI and Tailwind were all
  installed and all unused (zero `<v-…>`, one `<UApp>` wrapper, no utility
  classes) once these 24 primitives took over; removing the three cut the build
  from 247 s to 140 s and the client bundle from 7.5 MB to 1.3 MB. Don't add a
  component library back — add a primitive here. `app/assets/scss/main.scss` keeps aliases for the pre-token variable
  names. Toasts: `useAppToast()` + the single `<UiToaster>` in the layout.
  Icons: `<UiIcon name>` (one path map) — don't paste inline `<svg>`.
  `UiInput type="password"` renders its own show/hide toggle.
  Shared vocabulary lives in `app/utils/` — `order-labels.ts` (order status /
  delivery / payment / customer type labels, `nextOrderStatuses`),
  `product-status.ts`, `slugify.ts` (same transliteration as the backend),
  `safe-storage.ts` (storage that never throws), `form-values.ts`
  (`numOrNull`/`textOrNull`: on an update send `null` for a cleared field —
  `undefined` is dropped from the JSON and the backend reads it as "no
  change"; `toLocalInput`/`fromLocalInput` for `datetime-local`),
  `category-options.ts` (tree-ordered selects). `useSite()` gives `siteUrl` /
  `apiBase`, `usePageSeo()` the title/og/canonical set.
- **Dates are formatted in one place**, `app/utils/format-datetime.ts`
  (`formatDate`, `formatDay`, `formatDateTime`, `…WithYear`, `…WithSeconds`).
  Six screens each built their own `Intl.DateTimeFormat('ru-BY', …)`. A screen
  that needs the year or seconds imports that variant under the local name
  `formatDateTime`; everything else takes the default from auto-import.
- **API shapes are declared once**, in `app/types/api.ts` (`Brand`/`AdminBrand`,
  `Banner`/`AdminBanner`, `Order`/`AdminOrder`, `OrderItem`, `OrderStatus`,
  `Paginated<T>`, `ProductsResponse`) and `app/types/parsing.ts` for the
  admin parsing screens. They used to be re-declared in every page that fetched
  them — five copies of `Brand` — so a new field had to be added in five files
  and missing one was invisible to the linter and the build. Add the field
  here; pages import it. `CatalogProduct` and `CategoryNode` stay in their
  composables on purpose: they live next to the logic that consumes them.
- **«Пусто» and «не ответило» are different screens.** The storefront fetches
  softly (a failed rail degrades to an empty rail, so cached pages always
  render), which is right for a legitimately empty result and wrong for an
  outage — with the database down the customer was shown a shop with nothing
  in it. `utils/api-availability.ts` tells the two apart (no answer at all, or
  a 5xx; a 4xx is the API working and saying no), the home page and
  `CatalogView` turn an outage into a **503**, and `error.vue` renders that as
  the technical-works screen with a retry. The same rule covers the pages that
  used to answer **404** for an outage — `/product/:slug` («Товар не найден»
  for the whole catalogue while the DB is down is a lie to the visitor and a
  signal to search engines to drop the pages), `/brand/:slug`, plus `/sales`
  and `/brand`, which degraded to an empty page. `/sitemap.xml` is a
  **sitemap index** (one file was 55k URLs, over the protocol's 50k) pointing
  at `/sitemap-static.xml`, `/sitemap-categories.xml` and
  `/sitemap-products-N.xml` (10k each, served by
  `server/middleware/sitemap-parts.ts` — the router cannot match a partial
  segment, and children must sit at the root to list `/product/…`). All are
  cut from one in-process snapshot (`server/utils/sitemap.ts`, 1 h): a failed
  refresh keeps the previous snapshot, and with none they answer 503 instead
  of a sitemap listing only the static URLs. Nitro never caches a 4xx/5xx, so the
  outage page cannot outlive the outage. On the client the catalogue keeps its
  inline alert instead — the page is already rendered and a blip must not throw
  the visitor out of it.
- **Guest lists**: cart, wishlist (`stores/wishlist.ts`) and comparison
  (`stores/compare.ts`, max 4 items) are all localStorage-backed and loaded on
  `onNuxtReady` by the two sync plugins (`plugins/cart-sync.client.ts`,
  `plugins/lists-sync.client.ts`, both built on `utils/server-mirror.ts`). Pages `/favorites` and `/compare` are `ssr: false`.
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
  Admin pages share one skeleton: `<AdminPageHead>` + `.admin-page` /
  `.admin-form*` (`assets/scss/admin.scss`), `useAdminList()` for paged lists
  (page changes only through `setPage()`, so a filter change loads once and a
  stale answer is dropped), `useAdminAction().run()` for
  request → toast → reload, `<UiConfirm>` for confirmations, `<UiTable>` for
  tables. `/admin/stats` is shared by the sidebar and the dashboard through
  `useAdminStats()`.
  Admin pages just set `definePageMeta({ layout: 'admin' })` and can assume the
  session is valid; do **not** re-add per-page token forms. `useAdminApi()`
  rides on the session cookie (same-origin, plus `X-Requested-With`) and
  exposes `hasSession` instead of a token; the UI never holds one. Accounts live in `/admin/users`:
  `users/index.vue` lists and creates them, `users/[id].vue` is one account —
  profile, figures, **current orders with an inline status select** and the
  finished ones in a table (`GET /admin/users/:id` returns all of it). The
  admin order list and detail also show which account placed an order, linking
  back to that page; a guest order says so.
  `/admin/parsing` is the one screen split into components
  (`components/admin/parsing/*`: `sourceControl`, `cronHealth`, `runHistory`,
  `queuePanel`, `categoryQueuePanel`, `sourceSummary`, `dataQuality`,
  `importProduct`, `errorLog`) — it was 2000 lines of five unrelated screens.
  **State and every request stay on the page**; the panels take props and emit
  intent, so there is still one place that knows what is loaded and one place
  that reloads it after an action. A supplier queue is a controller object from
  `composables/useParserQueue.ts` (one factory per source), and the **list of
  them is built from `/parser/overview`** — which carries each source's `host`
  and the `queuePrefix` its queue endpoints sit under. It used to be four
  hard-coded lines, so a fifth supplier would have parsed with no queue on
  screen; that is why `PARSER_SOURCES` is the only place a supplier is
  declared. The
  chrome the panels share (`.pad`, `.stat-row`, `.toolbar`, `.pagination` …) is
  styled once on the page with `:deep()` rather than copied into nine scoped
  stylesheets.
- **Admin audit trail** (`audit/`, `AdminActionLog`, `/admin/audit`). Worth
  having only now that admins are accounts — under the shared token there was
  no "who". `AdminActionLogInterceptor` is registered **globally** (admin
  routes live in six controllers across four modules) and records a request
  when it is mutating **and** in admin scope: an ADMIN session, the
  `x-admin-token` header, or a path under `/admin` — that last one is what
  meant to capture attempts the guard rejected — but guards run *before*
  interceptors, so a rejected request never reaches it; those 401/403s on
  `/admin` are recorded by the exception filter into the error log instead.
  Reads are not logged, or the log would be dashboard polling. Bodies
  are stored with `password`/`token`/`secret`/`authorization` replaced by
  `[redacted]`, long arrays summarised and the whole thing truncated at 4 KB:
  it is evidence of what changed, not a replayable payload. A failed audit
  write is logged and swallowed — it must never turn a successful admin action
  into an error. `ADMIN_LOG_TTL_DAYS` (180) bounds the table.
- **Error log** (`errors/`, `ErrorLog`, `/admin/errors`). The audit says who
  changed what; this says what *broke*. `HttpExceptionFilter` is now registered
  through `APP_FILTER` in `AppModule` (not `useGlobalFilters` in `main.ts`) so
  it can be given `ErrorLogService` by DI — the response it sends is unchanged.
  What it keeps: **every 5xx**, plus the client errors an **admin-scope**
  request was answered with (400/405/409/413/415/422), plus **401/403 on
  `/admin` paths** — the only record of rejected admin attempts. A non-HTTP
  error's own message goes to the log only; the client gets
  `Internal server error` (it used to receive Prisma's invocation text).
  Bodies go through the audit's own redaction, so a password cannot land in a
  table an admin reads, and a stack is kept for 5xx only. Two bounds, both
  deliberate: a repeat of the same `status+method+path+message` inside 60 s
  bumps `occurrences` on the row it already wrote instead of inserting (one
  broken endpoint under load must not write a row per request), and
  `ERROR_LOG_TTL_DAYS` (30) prunes the rest. `GET /admin/stats` carries
  `recentErrors` (5xx in the last 24 h) for the sidebar badge.
  **Blank optional fields**: an untouched form input arrives as `''`, which
  `@IsOptional()` does *not* skip — so every optional text field with a minimum
  length rejected a valid blank form ("companyName must be longer than or equal
  to 2 characters" when creating an admin). Create DTOs run
  `@Transform(emptyToUndefined)` (`common/dto/`); update DTOs keep accepting
  `''`, because there it is the only way to clear a value.
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
  (HttpOnly cookie, so script never sees the token; "signed in" is learned
  from `GET /auth/me` in `plugins/auth.client.ts`, skipped for guests by a
  non-secret `auth-session` hint in localStorage; a leftover `auth-token`
  from the Bearer era is deleted on load). Pages `/login`, `/register` and `/account` are
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
- **Company buyers (юрлица).** A COMPANY account keeps its invoice
  requisites in `User` (`taxId` = УНП, `legalAddress`, `bankAccount` = BY
  IBAN, `bankName`, `bankBic`), validated by `common/utils/requisites.ts`
  (УНП mod-11 check digit, IBAN mod-97, BIC shape; the storefront has a copy in
  `utils/requisites.ts`) and stored normalized. **The payer is snapshotted into
  the order** (`Order.payer*`, `orders/order-payer.ts`): what checkout typed
  wins field by field, a company account fills the rest — reading it through
  `Order.user` lost it as soon as the profile changed or the account was
  deleted. `INVOICE` without an organisation and its УНП is a 400. Telegram,
  the shop letter and the customer's confirmation letter lead with the payer;
  admin order search matches the organisation and УНП. Checkout defaults a
  company to `INVOICE`, prefills the «Плательщик» block from the profile and
  saves typed requisites back into blank profile fields. One form component
  for all of it: `components/account/companyRequisites.vue`. Cart limits are
  sized for purchase requests — 9999 per line, 300 lines
  (`cart/cart-limits.ts`, mirrored in `stores/cart.ts`). Search matches a
  barcode (8–14 digits) as a whole code, including the `A (B)` pairs suppliers
  store; dukon.by publishes no barcodes at all.
- **B2B documents, leads, lists** (`b2b/`). **Invoice PDF**
  (`GET /orders/:id/invoice.pdf`, public by UUID like the confirmation) for an
  `INVOICE` order with a payer; **commercial offer PDF**
  (`POST /documents/quote`, re-priced from the DB, records a `QUOTE` lead);
  **XLSX price list** (`GET /price-list.xlsx?categorySlug|brandSlug`,
  streamed with exceljs in id-cursor chunks — never one workbook in the heap);
  **purchase lists** (`/account/purchase-lists`, ids + quantities only,
  hydrated from `Product` on read like the stored cart); **leads**
  (`POST /leads`: «уточнить наличие / подобрать аналог», the form on
  `/organizaciyam`; honeypot, @Throttle, ≤20/IP/day by salted hash; Telegram
  orders topic + shop mail; `/admin/leads`, `newLeads` badge). PDFs are
  pdfkit with Liberation Sans from `backend/assets/fonts` (the built-in fonts
  have no Cyrillic; the Dockerfile copies `assets/`). **No invoice without
  the seller's requisites**: bank account, bank, BIC and the VAT status live
  in `SiteSetting` (`seller.*`, `SellerService`, `/admin/settings`), no code
  default for any of them — a made-up account or a guessed VAT line is worse
  than none. Until they are set the order still goes through and the
  storefront says the manager will send the invoice; once set, the success
  page, the account history, the admin order and the customer's letter all
  link the PDF. «Счёт без регистрации» in the cart is an ordinary guest
  `POST /orders` with `INVOICE` + payer (`components/cart/invoiceRequest.vue`).
- **Traffic source on every order and lead** (`attribution/`). The
  storefront records, per page load (`plugins/attribution.client.ts`,
  `utils/attribution.ts`), the first visit ever and the last visit that had a
  source — UTM tags, `yclid`/`gclid`, the external referrer's host, the
  landing path; a direct visit never overwrites a known source, and a source
  older than 90 days is dropped. It is sent as `attribution` with
  `POST /orders`, `/leads` and `/documents/quote`; `traffic-source.ts` (pure,
  tested) labels it «yandex / cpc», «google / organic», «t.me / social»,
  «direct» into `trafficSource` (last non-direct touch) and
  `firstTrafficSource`. Shown in Telegram, the shop letter, the admin order
  and leads; the dashboard sums orders, revenue and leads per source over 90
  days. Reporting only — nothing trusts it.
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

- **AI-задачи** (`ai/`, `/admin/ai/{products,categories,tasks}`). Админ
  выбирает товары/категории (фильтры: категория с поддеревом, бренд,
  поставщик, статус, наличие, пустое поле, «уже обработан ИИ» — или «все по
  фильтру», который резолвится в id при создании), поля и промпт, и создаёт
  `AiTask` с `AiTaskItem` на каждую запись. Планировщик — `AiRunnerCron`
  (каждую минуту, одна задача, `AI_BATCHES_PER_TICK` пачек по `batchSize`
  записей в **одном** запросе: бесплатный ключ OpenRouter считает *запросы* —
  50 в сутки). 429 не валит записи, а ставит задаче `pausedUntil`; прочие
  ошибки — до 3 попыток на запись. Меняются **только текстовые поля**
  (`ai/ai-fields.ts`: name/описания/SEO) — цены принадлежат `PricingService`,
  идентичность — парсерам. Каждый item хранит `{field: {old, new}}`, откат
  возвращает старое значение только там, где поле всё ещё равно записанному ИИ.
  **`Product.aiLockedFields`**: поля, переписанные ИИ, `ProductIdentityService.save()`
  вырезает из `update` при перепарсинге — иначе суточный refresh вернул бы
  текст поставщика. Откат снимает блокировку только с полей, которые реально
  восстановил. Запись в сущность и в item — одна транзакция по свежему
  чтению (не по контексту двухминутной давности). Ответ модели чистится тем же
  `supplier-text.ts`. Из админки можно выбрать только `:free`-модель; 429 —
  пауза на весь ключ, а не на одну задачу; после ошибки пачки тик
  останавливается (не жжёт суточную квоту). Ключ — `OPENROUTER_API_KEY`
  (пусто = выключено), модель по умолчанию `OPENROUTER_MODEL`, с цепочкой
  запасных `:free`-моделей в `openrouter.client.ts`.

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
`GET /health/parser`, **behind `AdminGuard`** — it names suppliers, their
offer counts and queue failures, so monitoring sends `x-admin-token`; the
unauthenticated probes are `/health` and `/health/ready`).

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
the admin UI iterates — including `host` and `queuePrefix`, which is what lets
`/admin/parsing` grow a queue tab for a new supplier without a frontend change;
a new supplier has to be added there.

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
(service) + `7745.parser.ts` (pure parse fn) + `7745.cron.ts` (cron). Every
supplier service **extends `parser/supplier-queue-parser.ts`**, which owns the
queue (stats, listing, retry, revalidate, claimed batches, per-URL outcome,
delist/withdraw) — a parser supplies only `parseProductUrl`, `canonicalUrl`,
`isSkippedError` and the `supplier` info. dukon's pure HTML functions live in
`dukon.parse.ts`.

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

**Default catalogue order: complete cards first.** `Product.listingRank`
(real photo 2 + description 1) is recomputed hourly by `ListingRankService`;
the default sort and search ties order by it before the name, so the cards
without a photo or text sink to the end. An explicit sort ignores it.
Supplier tab labels in front of a description («Файлы BULL Электроинструмент
Описание: …», «Описание:») are stripped by `stripTabHeaders` in
`supplier-text.ts`.

**SEO bits worth not undoing.** `robots.txt` closes the client-rendered
private screens (their `noindex` exists only after JS) and has Yandex
`Clean-param` for tracking tags and `sort`. og:image is our own
`/_ipx/…&s_1200x630&fit_contain&b_ffffff` (`utils/og-image.ts`), never the
supplier URL. Product JSON-LD carries `gtin*` from the barcode,
`priceValidUntil` = last offer sync (`priceCheckedAt`) + 7 days, shipping and
return policy. A category's `seoDescription` equal to its name counts as
empty and the template is used until an AI task writes one.

**Supplier sales boilerplate never reaches our product text.** dukon.by's meta
description is a template — «Купить … в Минске с гарантией и доставкой … ☎ +375
(29) 668-00-11» — and its titles end in «купить в Минске»: a competitor's phone
and the wrong city on our pages and in the JSON-LD. `parser/supplier-text.ts`
(pure, unit-tested against the real production strings) drops those marketing
sentences and phone numbers and leaves anything without its markers
byte-for-byte alone; `ProductIdentityService.save()` applies it to every
parser's `descriptionShort/Full` + `seoTitle/Description`. Rows imported before
it are cleaned by `ProductTextCleanupService` a minute after boot (idempotent;
`PRODUCT_TEXT_CLEANUP_ON_BOOT=false` to skip, `POST /admin/parser/clean-product-texts`
to re-run) — the same tested function rather than a SQL copy of it.

**dukon.by specifics.** Its sitemap is stale (286 URLs; brand Nordberg showed
29 products against ~3k), so discovery is the catalog crawl: `/brands/` (141
brands over 8 `PAGEN_2` pages, 15 products per brand page) and `/catalog/`
(667 categories, 24 cards per `PAGEN_1` page). Brand cards are
`js-element[data-detail]`, not `.prod-list__item`. The crawl is resumable
(`ParserCatalogCrawl`, shared load/save in `SupplierQueueParser`) because a
full pass is ~10k pages and `DUKON_DISCOVERY_MAX_PAGES` (5000) cannot hold one;
brand pages are discovered first so a resumed pass keeps finding new products.
A page that fails transiently is deferred with an attempt count and dropped
after 3 (`MAX_CATALOG_PAGE_FAILURES`), and the run still reports ERROR rather
than SUCCESS when anything was deferred or dropped. `dukon.parse.ts` filters
off-site `/brands/` and paginator links, and `PAGEN_2` is pagination, not a
category.

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
- Keep parser HTTP polite: real user-agent, request delay, concurrency 1. Batch
  size is per source (`cron.<code>.batchLimit`): dukon and th-tools use 300, but
  a batch is just how long a run lasts — the 3 s delay and one request at a time
  are what keep the rate polite.
- Slugs via `common/utils/generate-slug.ts`; bounded concurrency via
  `common/utils/run-with-concurrency.ts`.

## Don't

- Don't commit `.env` / `.env.prod` (gitignored) or build artifacts
  (`backend/dist`, `frontend/.output`, `frontend/.nuxt`).
- Don't run `npm run build` for the frontend on Node < 22.
- Don't overwrite manual `HIDDEN` / `ARCHIVED` product statuses on re-parse.
