---
name: parser-ops
description: Run, dry-run, monitor, and debug the supplier parsers in construction-tools-api — locally or via the admin API. Use when asked to run/test a parser, preview a product URL, refresh/process a queue, retry failed URLs, check parser health, or investigate why a source isn't importing.
---

# Parser operations & debugging

All admin endpoints require header `x-admin-token: $ADMIN_TOKEN`. Base path is
`/admin` on the backend directly, or `/api/admin` through Caddy in prod.
Per-source code (`<code>`) examples: `7745`, `dukon`, `th-tools`.

## Cron gating
Crons only run when **both** the global and the per-source switch are on. Each
switch is a DB row (`ParserSetting`) falling back to an env var, so the fastest
check — and fix — is the admin, not the server:

```bash
curl -H "x-admin-token: $T" https://$DOMAIN/api/admin/parser/overview
curl -X PATCH -H "x-admin-token: $T" -H 'content-type: application/json' \
  -d '{"enabled":true}' https://$DOMAIN/api/admin/parser/cron
curl -X PATCH -H "x-admin-token: $T" -H 'content-type: application/json' \
  -d '{"cronEnabled":true,"batchLimit":300}' \
  https://$DOMAIN/api/admin/parser/sources/th-tools
```

`overview` returns `effectiveEnabled` per source — that, not the env var, is
what the cron checks. Env (`PARSER_CRON_ENABLED`, `<CODE>_CRON_ENABLED`,
`<CODE>_CRON_BATCH_LIMIT`) is only the default until a row exists.

Schedules: process every 30 min, refresh sitemap daily, category crawl hourly.
State is persisted in `ParserRuntimeStatus`, so health survives restarts.

**"Очередь стоит" is usually one of three things**, in order of likelihood:
the cron is off; the batch limit is too small (`batchLimit × 48` URLs/day — 30
means 1440/day, i.e. a month for a 39k queue); or every run fails, which shows
up in `/admin/queue/runs` and the error log.

## Category queue (th-tools)
```bash
curl -X POST -H "x-admin-token: $T" https://$DOMAIN/api/admin/parser/sources/th-tools/categories/refresh
curl -X POST -H "x-admin-token: $T" -H 'content-type: application/json' \
  -d '{"limit":3}' https://$DOMAIN/api/admin/parser/sources/th-tools/categories/process
curl -H "x-admin-token: $T" "https://$DOMAIN/api/admin/parser/categories?source=th-tools&status=PROBLEM"
# stop importing a branch entirely (also disables its SourceCategory subtree)
curl -X PATCH -H "x-admin-token: $T" -H 'content-type: application/json' \
  -d '{"isEnabled":false}' https://$DOMAIN/api/admin/parser/categories/<id>
```
Crawling a category walks its pagination and pushes newly found product URLs
into the products queue; it never writes products itself.

## Safe workflow for a new/changed source
1. **Preview (no DB writes)** — always do this first:
   ```bash
   curl -X POST https://$DOMAIN/api/admin/source-products/preview \
     -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"url":"<product-url>"}'
   ```
   Check name, sku, price, brand, breadcrumbs, images, specifications look right.
2. **Fill the queue**: `POST /api/admin/queue/<code>/refresh-sitemaps`.
3. **Process a small batch**: `POST /api/admin/queue/<code>/process { "limit": 5 }`.
4. Inspect results, then enable cron (`<CODE>_CRON_ENABLED=true`) and redeploy.

## Monitoring
```bash
curl https://$DOMAIN/health/parser                              # public health (ok + per-job status)
curl -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/runtime-status   # last-state + counters per job
curl -H "x-admin-token: $T" "https://$DOMAIN/api/admin/queue/runs?key=<code>-process&limit=20"  # run history (per-run duration/result/errorCount)
curl -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/<code>           # queued/visited/failed/skipped counts
curl -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/<code>/sitemaps?status=PROBLEM   # FAILED+SKIPPED rows
curl -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/errors           # last 200 ParserError entries
```
Job health is `OK` / `RUNNING` / `STALE` (no success within `maxAgeHours`, default 2) / `ERROR`.

## Recovering failed URLs
```bash
# retry one row
curl -X POST -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/<code>/sitemaps/<id>/retry
# retry all FAILED+SKIPPED for a source
curl -X POST -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/<code>/sitemaps/retry-problems
curl -X DELETE -H "x-admin-token: $T" https://$DOMAIN/api/admin/queue/errors   # clear error log
```

## Status semantics (when debugging "why isn't it importing")
- `PENDING` — queued, not processed yet.
- `DONE` — parsed and saved (`Product` + `SourceProduct`).
- `SKIPPED` — intentionally not a product / outside category include/exclude regex.
  **No `ParserError` is written.** Check the source's category filter env vars.
- `FAILED` — fetch/parse/save error; a `ParserError` with the message is recorded.
  Common causes: anti-bot/verification page, empty parsed name, selector drift, HTTP non-200.

## Local run / iterate on a parser
```bash
cd backend
npm run start:db-docker         # start just Postgres
npm run start:dev               # API in watch mode (set ADMIN_TOKEN + DATABASE_URL in backend/.env)
npm test -- --runInBand         # run the fixture-based parser specs
```
To debug a single source's parse logic, edit its fixture in
`src/parser/sites/fixtures/` and run its `*.parser.spec.ts`. The pure
`parse<Code>(html)` function is DB-free — exercise it directly in a spec rather than
hitting the live site. To add a brand-new source, use the **add-parser** skill.
