#!/usr/bin/env bash
# Creates (or updates) the database role the API and the worker connect as:
# rights on the data, none on the schema — not the superuser that
# POSTGRES_USER is. A compromised app process can then read and write rows,
# but cannot drop tables, create functions, read files or run programs on
# the database host through COPY … PROGRAM (audit 2026-11-03).
#
# Run once on the server, then switch the app over:
#   1. put DB_APP_USER=gost_app and DB_APP_PASSWORD=<long random> in .env.prod
#   2. bash deploy/db-app-role.sh          (idempotent; re-run after a password change)
#   3. docker compose … up -d backend worker   (or the next release)
# Undo: remove DB_APP_USER/DB_APP_PASSWORD from .env.prod and `up -d` — the
# app goes back to the owner role; the extra role is harmless.
#
# Migrations stay with the owner (auto-deploy passes it to the one-off
# migration container only). Tables a later migration creates are covered by
# ALTER DEFAULT PRIVILEGES below.
set -Eeuo pipefail
cd "${APP_DIR:-/opt/construction-tools/app}"

env_value() {
  sed -n "s/^$1=//p" .env.prod | head -1 | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
owner=$(env_value DB_USER); owner=${owner:-postgres}
db=$(env_value DB_NAME); db=${db:-construction_tools}
app_user=$(env_value DB_APP_USER)
app_password=$(env_value DB_APP_PASSWORD)
[[ -n "$app_user" && -n "$app_password" ]] || { echo "Set DB_APP_USER and DB_APP_PASSWORD in .env.prod first" >&2; exit 1; }
[[ "$app_user" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "DB_APP_USER must be a plain lowercase identifier" >&2; exit 1; }
[[ "$app_user" != "$owner" ]] || { echo "DB_APP_USER must differ from DB_USER" >&2; exit 1; }

# The password goes in as a psql variable on stdin, never on a command line.
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db \
  psql -v ON_ERROR_STOP=1 -U "$owner" -d "$db" \
  -v app_user="$app_user" -v app_password="$app_password" -v owner="$owner" -v db="$db" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
ALTER ROLE :"app_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

GRANT CONNECT ON DATABASE :"db" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
-- Tables and sequences later migrations create (they run as the owner).
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";

-- «Скорость» (/admin/performance): statistics of every session and the
-- pg_stat_statements reset button. Read-only views plus one function.
GRANT pg_read_all_stats TO :"app_user";
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I', p.oid::regprocedure, :'app_user')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'pg_stat_statements_reset' AND n.nspname = 'public' \gexec
SQL
echo "Role $app_user is ready. Restart backend and worker to connect as it."
