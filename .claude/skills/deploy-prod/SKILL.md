---
name: deploy-prod
description: Build and deploy the construction-tools-api production stack (db + backend + frontend + Caddy) with Docker Compose, and verify it. Use when asked to deploy, ship to prod, build prod images, set up the server, or troubleshoot the prod stack / migrations / TLS.
---

# Deploy to production

Stack (`docker-compose.prod.yml`): `db` (Postgres 15) + `backend` (NestJS) +
`frontend` (Nuxt Nitro) + `caddy` (reverse proxy, auto-TLS). Only Caddy is exposed
(`:80`/`:443`); the rest live on the internal `app-network`.

## One-time / each deploy
```bash
cp .env.prod.example .env.prod      # first time only
# fill: DB_PASSWORD, ADMIN_TOKEN (required), DOMAIN, PUBLIC_ORIGIN
sh deploy-prod.sh                   # docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```
Required secrets (compose fails fast without them): `DB_PASSWORD`, `ADMIN_TOKEN`.
For real HTTPS set `DOMAIN` (DNS must point at the server) and `PUBLIC_ORIGIN=https://<DOMAIN>`.
Optional: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` turn on new-order
notifications (both required; unset = silently disabled). Confirm with
`docker compose logs backend | grep Telegram` — it logs enabled/disabled on boot.
Keep `*_CRON_ENABLED=false` on the first deploy; enable parsers after a preview dry-run.

## What happens on start
- Backend Dockerfile CMD runs `npx prisma migrate deploy && node dist/main`.
  Migrations live in `backend/prisma/migrations` (baseline `00000000000000_init`).
- Frontend serves prebuilt `.output` (built with `NUXT_PUBLIC_API_BASE=/api`).
- Caddy obtains a cert for `DOMAIN` and proxies `/api/*`→backend, `/*`→frontend.

## Hardware
Build happens on the server (`--build`). The Nuxt build is the memory bottleneck.
- Comfortable: **2 vCPU / 4 GB / 40 GB SSD** (parsers off).
- Minimum: 2 vCPU / 2 GB **+ 4 GB swap** (build OOMs otherwise); build services one at a time.
- With Playwright parsers active: 8 GB.
- 10–20 GB disk works if you `docker system prune` after deploys (build cache is the eater).

## Verify (smoke test)
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps        # all Up, backend not restarting
docker compose --env-file .env.prod -f docker-compose.prod.yml logs backend | grep -i migration
curl -I https://$DOMAIN/                 # 200, expect cache-control: s-maxage=... stale-while-revalidate (ISR)
curl https://$DOMAIN/api/products?limit=1
curl -H "x-admin-token: $ADMIN_TOKEN" https://$DOMAIN/api/admin/stats   # 200; wrong/no token -> 401
```

## Monitoring (host watchdog)
`deploy/watchdog.sh` + `construction-tools-watchdog.{service,timer}` (every
2 min) alert Telegram — same `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` from
`.env.prod` — when `/` or `/api/health/ready` fails twice in a row, a
container's `RestartCount` grows (with `OOMKilled` and `docker stats` memory vs
`mem_limit`), or a container is unhealthy; once per incident, plus "recovered".
State: `/var/lib/construction-tools/watchdog.state`. Install like the other
timers (full steps in `DEPLOY_PRODUCTION.md` → "Host watchdog"):
```bash
install -m 755 deploy/watchdog.sh /usr/local/sbin/construction-tools-watchdog
install -m 644 deploy/construction-tools-watchdog.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now construction-tools-watchdog.timer
journalctl -u construction-tools-watchdog.service -n 50 --no-pager
```
It can't alert if the host itself is down — keep an external uptime check
(e.g. UptimeRobot on `/` and `/api/health/ready`) too.
Intermittent 502s: check `docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}}' construction-tools-front`.

## Gotchas (seen in practice)
- **Backend restart-loops with `P1000 Authentication failed`** → the `postgres_data`
  volume was created earlier with a different `DB_PASSWORD` (Postgres only applies
  the password on first init). For a throwaway/test stack: `... down -v` then up.
  In real prod, fix `DB_PASSWORD` to match the existing volume instead of wiping data.
- **Frontend build fails with `crypto.hash is not a function`** → Node < 22. The
  Docker image is `node:22`, so this only bites local builds; use Node ≥ 22 locally.
- **Caddy serves only the `DOMAIN` host** (`{$DOMAIN}` site). Hitting it by container
  name/IP without `Host: <DOMAIN>` returns nothing. Test with the real domain or
  `curl --resolve <DOMAIN>:443:<ip>`.
- Never switch prod back to `prisma db push` — the migration baseline is authoritative.

## Useful
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f <backend|frontend|caddy>
docker compose --env-file .env.prod -f docker-compose.prod.yml down        # stop (keep data)
docker system prune -f                                                     # reclaim build-cache disk
```
