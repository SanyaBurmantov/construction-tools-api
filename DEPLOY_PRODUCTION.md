# Production Docker Deploy

## One Command

After filling `.env.prod`, deploy or update production with:

```bash
sh deploy-prod.sh
```

The script runs:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## First Server Setup

1. Install Docker and Docker Compose plugin.
2. Clone the repository on the server.
3. Create env file:

```bash
cp .env.prod.example .env.prod
```

4. Edit `.env.prod`:

- `DOMAIN`: real domain pointed to the server.
- `PUBLIC_ORIGIN`: `https://<DOMAIN>`.
- `DB_PASSWORD`: long random password.
- `ADMIN_TOKEN`: long random admin token.
- Keep `PARSER_CRON_ENABLED=false` for the first deploy; enable only after manual parser checks.

5. Start:

```bash
sh deploy-prod.sh
```

## What It Runs

- `db`: PostgreSQL 15 with persistent `postgres_data` volume.
- `backend`: NestJS API on internal `backend:8000`.
- `frontend`: Nuxt Nitro node-server on internal `frontend:3000` with ISR/SWR route rules.
- `caddy`: public reverse proxy on ports `80` and `443`, automatic TLS for `DOMAIN`.

## Backend DB Schema

The backend production container runs:

```bash
npx prisma migrate deploy && node dist/main
```

The schema is managed by Prisma migrations in `backend/prisma/migrations`. The history
starts with a squashed baseline migration (`00000000000000_init`), followed by the
June and August 2026 changes. Older March migrations are archived in
`backend/prisma/_migrations_archive_pre_baseline` and must not be applied after the
baseline. New schema changes must be added as migrations and committed.

## Useful Commands

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f frontend
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f caddy
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

## Smoke Test

After deploy:

```bash
curl -I https://$DOMAIN/
curl -I https://$DOMAIN/catalog/
curl https://$DOMAIN/api/products?limit=1
```

Expected public pages should include `cache-control: s-maxage=... stale-while-revalidate`.

## GitHub `prod` deployment

The server checks the GitHub `prod` branch every two minutes with
`construction-tools-deploy.timer`. A new commit is checked out, the backend
tests and both application images are built, and the public site is checked
before the new commit is recorded as deployed. A failed release is recorded in
`/opt/construction-tools/failed.sha` and the previous commit is restored.
GitHub Actions runs backend tests and builds both applications on pushes and
pull requests to `main` and `prod`.

Create `main` from the current `master` branch, then create `prod` from `main`.
Push code changes to `main` and promote tested commits to `prod`. The server
only deploys `prod`. Its checkout is `/opt/construction-tools/app`; secrets
are in the untracked, root-readable `.env.prod` file there.

```bash
systemctl status construction-tools-deploy.timer
journalctl -u construction-tools-deploy.service -n 100 --no-pager
systemctl start construction-tools-deploy.service # check immediately
cat /opt/construction-tools/deployed.sha
```

Daily compressed PostgreSQL backups are made by
`construction-tools-backup.timer` into `/opt/construction-tools/backups`. They
are retained for three days. Restore a backup into an empty database with
`gunzip -c <backup>.sql.gz | docker compose --env-file .env.prod -f
docker-compose.prod.yml exec -T db psql -U postgres -d construction_tools`.
These backups are on the same server; configure an external backup destination
when one is available.
