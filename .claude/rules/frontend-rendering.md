---
paths:
  - "frontend/nuxt.config.ts"
  - "frontend/server/**"
  - "frontend/app/error.vue"
  - "frontend/app/app.vue"
  - "frontend/app/plugins/**"
  - "frontend/app/middleware/**"
  - "frontend/app/pages/**"
  - "frontend/app/components/ui/UiBreadcrumbs.vue"
  - "frontend/app/utils/api-availability.ts"
  - "backend/src/products/legacy-product-slug.ts"
  - "deploy/warm-cache.sh"
  - "deploy/caddy/**"
---

# Frontend: SSR, cache, URLs

ISR route rules, the bounded page cache and its warm-up, canonical and legacy URLs, CSS/fonts, early clicks, outage vs empty screens, sitemaps.

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
  **Old addresses of the domain** — an OpenCart workwear shop (2017–2019:
  `/spetsodezhda`, `/siz`, `/spetsobuv`, `index.php?route=…`) and a Bitrix
  site (until 2025) lived on gost.by, and visitors still arrive by their links:
  `server/middleware/0.legacy-urls.ts` (runs first) 301s each old section to
  our closest category (`utils/legacy-urls.ts`, tested) — they were the
  «Страница не найдена» views in Metrika.
  **Article-first product addresses** (`products/legacy-product-slug.ts`):
  robots visit ~250 `/product/<article>-<name in kh/ts/yy translit>` URLs
  that were never ours; `getProductBySlug` falls back to the article (ILIKE
  on the trigram-indexed `sku`, exact slug compare, name words to tell
  same-article products apart, nothing when still ambiguous) and answers
  `redirectTo`, which the product page turns into a 301 — 119 of 258 found.
  Second chance, **by item code** (STARFIX «pack-code-qty»: `SMP-63731-1` is
  the 63731 screw in a pack we do not carry): products whose article holds
  the code *and* whose name backs more than half of the address's words —
  one → 301 to it, several packs → `searchTo` = their common name, a 302 to
  the catalogue search (19 more; 138 of 258).
  **No render-blocking CSS**: `features.inlineStyles: true` inlines every SSR
  style (global `main.scss` included) and `server/plugins/defer-unused-css.ts`
  turns the remaining `<link rel=stylesheet>` — CSS of components imported but
  not rendered (`<ClientOnly>`, `v-if`) — into `preload`; Vite's import helper
  attaches it on the client. Keep component styles `scoped` for that to hold.
  **«Поделиться» on every page** (header, `composables/useShare.ts`): the
  system share sheet on a touch device, a menu (Telegram, Viber, WhatsApp,
  VK, mail, copy link) elsewhere; channel links carry
  `utm_source=<channel>&utm_medium=share`, the copied link is clean. The
  product page puts the article beside the brand, copied on click
  (`utils/clipboard.ts`).
  **A press before hydration is not lost**: an inline script first in
  `<head>` (`earlyClickScript`, nuxt.config.ts) catches clicks on
  `[data-early-click="<key>"]` while the page is still server HTML, dims the
  button (`data-early-pending`) and `plugins/early-clicks.client.ts` replays
  each key once after `app:suspense:resolve`. Every buy button carries a key
  (catalogue card/row, buy box, sticky bar, packs) — give one to any new
  button whose press must not vanish on a slow phone.
  Manrope is self-hosted from `public/fonts/` (no Google Fonts, and the CSP in
  `deploy/caddy/Caddyfile` no longer allows it). That cache lives in the
  frontend's heap, and Nitro's stock production driver never evicts — a crawl
  over 52k products filled the 384 MB container until it was OOM-killed (502s
  while it restarted). `nitro.storage.cache` is therefore a **bounded LRU** — in production **on
  disk** (`server/storage/bounded-fs.ts`, volume `page_cache` at
  `NUXT_CACHE_DIR`, gzip, 1.5 GB = ~45k pages, `NUXT_CACHE_DISK_MB`; stops
  writing below 1 GB free disk), one directory per frontend build (a cached
  page points at that build's `/_nuxt/` hashes) — so a restart of the same
  build keeps the cache and serves pages even with the API down; without
  `NUXT_CACHE_DIR` it is `bounded-memory.ts` (`NUXT_CACHE_MAX_MB`). Don't swap
  it back for the plain memory driver.
  **After a release the cache is warmed** (`deploy/warm-cache.sh`, started by
  auto-deploy as the transient unit `construction-tools-warmup`, not waited
  for): home, catalogue, info pages, header strip + root categories, «Выбирают
  покупатели» and the first products of every root category round-robin —
  one page at a time, ≤ `WARM_MAX_PAGES` (220). The cache is per build, so
  every deploy used to start cold for visitors and crawlers.

- **Breadcrumbs** (`components/ui/UiBreadcrumbs.vue`, 05.11): crumbs cut
  with «…» past a width (full name in `title` and the JSON-LD), the trail
  wraps instead of scrolling, two or more middle levels fold into «…» on a
  phone. A crumb with `category` (`BreadcrumbItem`: a slug, `''` for
  «Каталог» = the roots) opens its subcategories on hover/focus — hover
  devices only, fetched once per category (`useCategoryChildren`, `GET
  /categories/:slug`). The product page shows the **whole** path:
  `GET /products/:slug` carries `categoryAncestors` (recursive CTE by
  `parentId`, root first) — it used to jump from «Каталог» to the leaf.
  The product's Описание / Характеристики / Отзывы tabs render every panel
  and hide the inactive ones (`v-show`), so the specs are in the HTML.

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
