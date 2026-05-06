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
npx prisma db push && node dist/main
```

This is intentional because this repository currently does not contain Prisma migration files. When real migrations are introduced later, change the backend Dockerfile back to `prisma migrate deploy`.

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
