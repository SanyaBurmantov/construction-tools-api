---
paths:
  - "backend/src/parser/**"
  - "backend/src/catalog-normalizer/**"
  - "backend/src/sources/**"
  - "SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md"
  - "frontend/app/components/admin/parsing/**"
  - "frontend/app/pages/admin/parsing.vue"
---

# Parsing (the core of this project)

Queue model, reliability guarantees, runtime parser settings, per-supplier specifics, supplier text cleanup, which specs become filters.

## Flow and configuration

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
| proxy address (all sources) | `parser.proxyUrl` (`''` = none) | `PARSER_PROXY_URL` |
| proxy mode | `parser.<code>.proxyMode` (`off`/`auto`/`always`) | — (default `auto`) |
| photos through the proxy | `parser.proxyImages` | — (default off) |

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

Canonical, complete example to copy from: **`backend/src/parser/sites/th-tools-source.parser.ts`**
(service) + `th-tools.parser.ts` (pure parse fn) + `th-tools.cron.ts` (cron), with
`th-tools.parser.spec.ts` against `fixtures/` (leave out its category crawler —
th-tool.by specific). Every
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

## Reliability

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

## Connection to suppliers: bans and the proxy

**Suppliers ban our server's IP** (th-tool.by from 2026-11-01, dukon.by from
2026-11-09: ping answers, TCP 80/443 is dropped). Nothing said so: every batch
"finished" `saved: 0, failed: 150` after 90 minutes of retries and was
recorded as SUCCESS. So **every supplier request goes through
`SupplierConnectionService.fetch()`** (`parser/connection/`, `@Global()`):
the parsers via `SupplierQueueParser.fetchSupplier()`, the sitemap reader, the
category crawler and the photo mirror. It matches the URL to a source by host
(`sourceForUrl`, subdomains included), picks the route and counts the answer
per route (DIRECT / PROXY) in `SupplierConnection`: any HTTP answer but 403/429
is OK (a 404 is the site working), 403/429 is DENIED, no answer is
UNREACHABLE; `BLOCKED_AFTER_FAILURES` (5) in a row = **BLOCKED**, one answer =
OK again. Rules are pure and tested (`supplier-connection.ts`).
- **Route**: mode `off` = direct, `always` = proxy, `auto` (default) = proxy
  only while direct is BLOCKED and back once direct answers. No proxy
  configured = always direct. Photos stay direct unless `parser.proxyImages`
  (a paid proxy counts traffic: ~65 KB a photo).
- **A blocked route stops the work, it does not burn it**: `processSitemapsBatch`
  and the category crawl call `assertUsable()` first and fail the run with the
  reason (`SupplierBlockedError`); a ban that starts mid-batch stops the batch
  after the URL that tipped it (in `auto` the route has just moved to the proxy
  and the batch goes on) and hands the untouched rows back (`lastTriedAt = null`).
- **The probe** (`SupplierConnectionCron`, worker, every 10 min at :04) knocks
  on each supplier's home page on every route — it is what notices a lifted
  ban while no batch runs. «Проверить» on `/admin/parsing` does the same from
  the API. The watchdog alerts Telegram once when a source moves to the proxy
  and once when it has nowhere to go.
- **State is shared through the table**: both processes write it (the worker
  on every failure and at most once a minute while healthy, the API on a
  check) and re-read it every 5 s. A new proxy address clears the PROXY rows.
- **The proxy is HTTP(S) only** (undici `ProxyAgent`, CONNECT; SOCKS is
  refused on save). Its password never leaves the server: the API returns
  `maskProxyUrl()`, the audit log and the error log redact `proxyUrl`.
- `undici` is a direct dependency for `ProxyAgent`; its dispatcher is passed to
  Node's own `fetch`, checked with Node 22.
- Specs build parsers with `directConnection()` (`connection/direct-connection.testing.ts`).

## Suppliers

**Sources.** `th-tool.by`, `dukon.by` and `tools.by` are the suppliers. The
sample site `7745.by` (never a supplier) and its parser, cron, queue table
(`Sitemaps7745`, dropped in `20261029130000_drop_7745`) and env vars were
removed on 2026-10-29 at the owner's request — don't bring it back.

**th-tool.by specifics** (`th-tools.parser.ts` pure + `th-tools-source.parser.ts`
service): it is a Webasyst shop with ~39k products on
flat one-segment URLs (`/<slug>/`), so `isThToolsProductUrl()` in
`sitemaps.service.ts` filters `/category/` and static pages out of the queue
*before* they cost an HTTP request. The page exposes `Штрихкод` in its spec
table — that becomes `Product.barcode`, which is the only signal besides
brand+sku that auto-merges duplicates, so don't drop it. Availability comes from
`[itemprop="availability"]`, and the gallery serves every photo at three sizes
(`.750x0` / `.970` / `.0x600`), deduplicated by the size-stripped URL. The
supplier also carries car accessories, bikes, garden and toiletries, and
**we import all of it** (owner, 2026-11-05: «пускай заказывает человек всё,
что хочет»). The default exclude regexes of th-tool.by and tools.by are
empty — in `parser-defaults.ts` *and* in `docker-compose.prod.yml`, whose env
defaults used to carry a copy; ~7.7k products were kept out and the hidden
cards answered «Страница не найдена» (migration
`20261105120000_import_every_category` brought them back). A filter is still
a runtime setting per source in `/admin/parsing`; regexes are unit-tested in
`th-tools-category-filter.spec.ts` — a typo there silently empties the catalogue.

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

## Supplier text and specs

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

**dukon.by's PHP var_dump never reaches our text either**: its product page
prints a `var_dump` of the catalogue record (up to 2.5 MB, 1 480 cards
showed it until 2026-11-06); `stripVarDump` in `supplier-text.ts` cuts it by
its own grammar (brace depth, `string(N)` skipped by byte length) for every
parser, and the boot cleanup picks old rows up. **A batch pass never loads
text columns in bulk**: the first version selected 500 rows with their
descriptions — dumps of up to 2.5 MB each — and the worker ran out of heap a
minute after every start (crash loop 11:45–13:24 on 2026-11-06; parsing and
outbox sweeps stood still, no order was affected). Select ids, then read one
row at a time.

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
