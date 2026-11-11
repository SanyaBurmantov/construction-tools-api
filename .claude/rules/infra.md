---
paths:
  - "deploy/**"
  - "docker-compose*.yml"
  - "deploy-prod.sh"
  - ".github/**"
  - "backend/Dockerfile"
  - "frontend/Dockerfile"
  - "backend/src/main.ts"
  - "backend/src/main.worker.ts"
  - "backend/src/app.module.ts"
  - "backend/src/common/utils/**"
  - "docs/postmortems/**"
---

# Processes, deploy and operations

API and worker processes, containers, memory guards, routing in prod, image builds, uptime checks, postmortems.

## Containers and guards

- **deploy/**, `docker-compose*.yml`, `deploy-prod.sh` — Docker deploy (db + backend + worker + frontend + Caddy).
  The prod box had 1.8 GB (2.9 GB since 2026-11-02) for all five containers, so backend/worker/frontend/Caddy
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
  The worker is also capped at one CPU (`cpus: ${WORKER_CPUS:-1.0}`,
  `cpu_shares: 512`): background work may run slower, the storefront and
  Postgres always keep a core.
  **The worker** (`construction-tools-worker`) has no HTTP to hang on, so it
  carries its own two: a heartbeat file the healthcheck checks, and an
  event-loop watchdog thread (`common/utils/event-loop-watchdog.ts`) that
  SIGKILLs the process when the loop is silent for 3 min — which is why the
  service has `init: true` (the kernel ignores a SIGKILL to PID 1).
  **From outside**: `.github/workflows/uptime.yml` runs
  `deploy/uptime-check.sh` every 5 minutes on GitHub's runners (home page and
  catalogue must answer 200 *and* mention gost.by — a wrong DNS record answers
  200 too —, `/api/health/ready`, TLS certificate ≥ 14 days) and alerts the
  Telegram alerts topic on a change of state and hourly while down. Secrets
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, `TELEGRAM_ALERT_THREAD_ID`
  live in the GitHub repository settings.

## API and worker

- **Two processes, one codebase: API and worker.** `PROCESS_ROLE`
  (`common/utils/process-role.ts`) splits the backend: `api` (`main.ts`,
  container `backend`) serves HTTP only; `worker` (`main.worker.ts`,
  `createApplicationContext`, no HTTP) runs **every cron, the parsers, the AI
  runner and the boot passes** (brand/text cleanup, listing rank, the RUNNING
  reset). Unset = both in one process — `npm run start:dev` and the tests
  behave as before. They used to share one 512 MB heap, so a parser batch that
  ate memory took the storefront down (the 13-hour hang). Mechanics worth
  keeping: `ScheduleModule.forRoot()` is loaded only where
  `runsBackgroundJobs()`, so `@Cron`/`@Interval` are inert in the API without
  touching each cron; a new boot-time pass must check `runsBackgroundJobs()`
  (and the admin bootstrap/SMTP check `servesHttp()`), or both processes run
  it. **The per-source lock lives in the worker's memory**, so the API never
  runs a parser job itself: `ParserJobRequestService` writes a
  `ParserJobRequest`, the worker claims it (`@Interval` 3 s, conditional
  update) and runs it through `ParserJobsService.runRequested()` — queued
  behind the lock like a waiting cron job — and records the outcome. The jobs
  panel's buttons answer 202 at once; the synchronous `/admin/queue/*` and
  category-queue endpoints **wait** for the outcome (≤ 20 min, then 504 while
  the job keeps running), so the runbook's curl contract is unchanged. The API
  sees the lock through the DB: `ParserRuntimeStatus.isRunning`,
  `.waitingSince` (the «Ждёт окончания батча» mark the worker writes) and open
  requests. The worker stamps `SiteSetting worker.heartbeatAt` every 30 s;
  `getHealth()` is `ok: false` when it is older than 3 min, and the API answers
  503 to a job request nobody would pick up. Admin actions that are only DB
  work (clean brands/texts, pricing, merges, single-product import) still run
  in the API.

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

## Releases

- **Images are built by GitHub Actions, not on the server** (`ci.yml` jobs
  `image` + `images-prod`, pushed to `ghcr.io/sanyaburmantov/construction-tools-{backend,frontend}:<sha>`
  for the prod branch, built **in parallel with** lint/tests; the `images-prod` check needs both, so a red commit is never deployed). The backend Dockerfile copies `prisma/` only after `npm ci`, so a migration does not reinstall the dependencies. `auto-deploy.sh` waits for the
  commit's `images-prod` check via the GitHub API, pulls, and rolls back to
  the kept `:rollback` images in seconds; a commit CI rejected is not
  deployed (one Telegram alert). Building on the box (load 16 on 2 cores,
  10–15 min of a slow site) is only the fallback after 30 min without a CI
  answer or a failed pull. Details: the `deploy-prod` skill.

## Incidents

After an outage customers noticed (or one that could have lost data) write a
blameless postmortem in `docs/postmortems/` from `TEMPLATE.md`: what was
seen, the timeline, the chain of causes, what changed (with commits) — and
the rule it taught goes into the matching file here in `.claude/rules/` (a project-wide one — into `CLAUDE.md`).
