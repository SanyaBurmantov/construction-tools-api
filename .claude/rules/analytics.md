---
paths:
  - "backend/src/perf/**"
  - "backend/src/traffic/**"
  - "backend/scripts/metrika-goals.mjs"
  - "frontend/app/utils/metrika.ts"
  - "frontend/app/utils/page-view.ts"
  - "frontend/app/plugins/metrika-goals.client.ts"
  - "frontend/app/plugins/page-views.client.ts"
  - "frontend/app/composables/useCookieConsent.ts"
  - "frontend/app/pages/admin/performance.vue"
  - "frontend/app/pages/admin/traffic.vue"
---

# Measurement: speed, traffic, Metrika

Request timing and SLOs, pg_stat_statements, facets cache, our page-view counter and the 404 journal, Yandex Metrika reports and goals.

- **Speed is measured, not guessed** (`perf/`, `/admin/performance`
  «Скорость»). Three sources: (1) every API request is timed from arrival to
  `finish` by `RequestTimingMiddleware` and aggregated per **route template**
  (`/products/:slug`, so one product is not a row) in the API process's
  memory — count, avg, p50/p95 over a 300-sample ring, max, 5xx, plus the
  last 100 requests over 1 s (`request-stats.ts`, bounded; a deploy resets
  it); (2) **pg_stat_statements** — loaded by the db service's `command`
  in `docker-compose.prod.yml` (with the Postgres sizing for this box:
  256 MB buffers, 1 GB effective cache, SSD costs, `log_min_duration_statement`
  1 s to the container log) and created by a migration — ranked by total
  time, mean time or calls, with a reset button for before/after an
  optimisation; (3) database vital signs: cache hit ratio, connections,
  statements running > 1 s right now, tables read by full scans, dead rows.
  `PerfService` checks every minute in the API: ≥ `PERF_ALERT_SLOW_COUNT`
  (20) requests over 1 s within 5 min → «🐢 Сайт отвечает медленно» in the
  Telegram alerts topic, at most hourly. The external uptime check
  (`deploy/uptime-check.sh`) fails a 200 that is slower than `MAX_SECONDS`
  (5 s; 8 s for the uncached `/api/products` it now also checks).
  Measured 2026-11-03 before any tuning: cached pages ~50 ms (≈30 rps at 20
  parallel cold-TLS clients on a busy box), an uncached catalogue filter
  1–8 s. pg_stat_statements named the causes the same day: Prisma's
  `_count: { sourceProducts }` in the list include grouped every
  SourceProduct row per listing (7.9 s for «Крепеж»; now `offerCounts()` for
  the page's ids, 2 ms), and the `(status, listingRank, name)` index could not
  serve `listingRank DESC, name ASC` (now `listingRank DESC` in the index).
  **Don't put `_count` of a big relation into a list query's include.**
  A listing's total + facets (~0.5 s, most of its cost) are cached in the
  API's memory for **15 min** per filter set (`FACETS_CACHE_TTL_MS`; it was
  2 min), and `FacetsWarmupService` — in the API process, where that cache
  lives — refreshes the whole catalogue and up to 40 category pages (header
  strip, featured, roots) every 10 min, one at a time, before they expire.
  The route table also counts **DB operations per request**
  (`perf/query-context.ts`: an AsyncLocalStorage store opened by the timing
  middleware, counted by a `$use` in `PrismaService`) — a route averaging
  over `N_PLUS_ONE_QUERIES` (15) is flagged «похоже на N+1». And the
  **SLOs** are written down in `request-stats.ts` (`SLO_TARGETS`: catalogue
  99% ≤ 1 s, checkout 99% ≤ 2 s, whole API 95% ≤ 1 s, 5xx budgets) and
  shown met/missed on the same screen.

- **Traffic statistics** (`traffic/`, `PageView`, `/admin/traffic`
  «Посещаемость», 05.11 — the owner wanted Metrika-style numbers in our own
  admin). The browser reports each page shown (`POST /traffic/views`,
  `plugins/page-views.client.ts` + `utils/page-view.ts`): a **visit** starts
  after 30 min without a page (Metrika's rule), the visitor id is a random
  value in localStorage (identifies nobody), the device comes from the
  User-Agent (`traffic/visitor-agent.ts`, a Mac with touch = iPad), bot
  agents are dropped, admins and `/admin` are never counted. **Every 404**
  is a row too, reported by `error.vue` with the page that linked to it
  (`history.state.back` after a client-side move, `document.referrer` on a
  load) — the «Страница не найдена» journal. Months/days are Minsk calendar
  (`traffic-periods.ts`, tested); «this month» is compared with the *same
  stretch* of last month, never the whole of it. The dashboard shows four
  tiles from `GET /admin/traffic/summary`. `TRAFFIC_LOG_TTL_DAYS` (730),
  purged nightly by the worker. Starts empty on 2026-11-05 — Metrika keeps
  the history before that.
  **Yandex Metrika on the same screen** (`traffic/metrika.service.ts`,
  `metrika-report.ts` pure + tested): switch «Яндекс.Метрика / Наш счётчик»,
  default Metrika once connected. Counter 113800110 (`METRIKA_COUNTER_ID`),
  read-only OAuth token pasted on the screen → `SiteSetting metrika.token`
  (checked against the counter before it is kept, never sent back; env
  `METRIKA_TOKEN` as fallback). Each block is its own Reporting API request
  (a refused one becomes a warning, a 401 the whole error), cached 15 min in
  the API; 404s there = pageviews titled «…не найден…». The dashboard tiles
  prefer Metrika's summary. **Every Metrika number is people only**
  (`isRobot=='No'`): in the counter's first ten days 1 299 of 1 780 visits
  and 260 of 301 visits to a 404 were robots (headless Chrome, Singapore /
  China, walking old product URLs). Address lists (landings, pages, 404s)
  are read *with* robots and labelled so — under the people filter Metrika
  hides every URL row below its privacy threshold.

- **Metrika goals and e-commerce** (`utils/metrika.ts`, 05.11 — ads learn
  from orders, not clicks). **Metrika loads only after consent** (06.11,
  Закон № 99-З): the head snippet only defines `window.__gostMetrika()` and
  calls it when localStorage `cookie-consent` holds `choice: 'all'`; the
  banner (`LayoutCookieConsent`, `useCookieConsent`) calls it on «Принять
  все», «Настройки cookie» in the footer reopens it, a later refusal wipes
  `_ym*` and reloads. No `<noscript>` pixel. Without consent `window.ym` does
  not exist and goals are skipped — expect fewer visits than before 06.11. The storefront fires «JavaScript-событие» goals:
  `order` / `order_invoice` (with `order_price`), `lead`, `quote`,
  `price_list`, `register` / `register_company`, `checkout`, `add_to_cart`,
  `phone_click` / `messenger_click` (one delegated listener,
  `plugins/metrika-goals.client.ts`), plus `dataLayer` e-commerce `add` and
  `purchase`. The goals themselves are created in the counter by
  `backend/scripts/metrika-goals.mjs` (idempotent, needs a `metrika:write`
  token). Never rename a goal id — its goal stops counting; add a new one.
