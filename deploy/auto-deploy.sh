#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/construction-tools/app
ENV_FILE="$APP_DIR/.env.prod"
LOCK_FILE=/run/lock/construction-tools-deploy.lock
STATE_FILE=/opt/construction-tools/deployed.sha
FAILED_FILE=/opt/construction-tools/failed.sha

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0
cd "$APP_DIR"

if ! GIT_TERMINAL_PROMPT=0 timeout 30s git fetch --quiet --depth=1 origin refs/heads/prod; then
  echo "GitHub prod branch is not available yet"
  exit 0
fi

target=$(git rev-parse FETCH_HEAD)
if [[ "$target" == "$(cat "$STATE_FILE" 2>/dev/null || true)" ||
      "$target" == "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]]; then
  exit 0
fi

previous=$(cat "$STATE_FILE" 2>/dev/null || git rev-parse HEAD)
git checkout -q -f -B prod "$target"
compose=(docker compose --parallel 1 --env-file "$ENV_FILE" -f docker-compose.prod.yml)
# Quotes stripped like watchdog.sh's env_value: DOMAIN="gost.by" made every
# health curl fail, so each release was marked failed and rolled back.
domain=$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | head -1 | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//')

# Migrations run as their own step, before any container is replaced, and
# after a fresh backup (audit 2026-10-30). They used to run in the backend's
# CMD: a failing one crash-looped the new API while the old one was already
# gone, and Prisma recorded it as failed — so the rollback's own
# `migrate deploy` stopped at P3009 and the old release could not start
# either. Now a failed migration is marked rolled back and the deploy fails
# while the running release is still untouched.
pending_migrations() {
  [[ "${1:-}" == "$2" ]] && return 1
  # New migration directories between the running release and the target;
  # when git cannot tell (an object gone from the shallow clone), assume some.
  local added
  added=$(git diff --name-only --diff-filter=A "$1" "$2" -- backend/prisma/migrations 2>/dev/null) || return 0
  [[ -n "$added" ]]
}

migrate() {
  bash "$APP_DIR/deploy/backup-db.sh" || {
    echo "Backup before migration failed; not migrating" >&2
    return 1
  }
  if "${compose[@]}" run --rm --no-deps -T backend npx prisma migrate deploy; then
    return 0
  fi
  echo "Migration failed; marking it rolled back so the previous release can start" >&2
  local failed
  failed=$("${compose[@]}" exec -T db sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select migration_name from _prisma_migrations where finished_at is null and rolled_back_at is null"' || true)
  for name in $failed; do
    "${compose[@]}" run --rm --no-deps -T backend npx prisma migrate resolve --rolled-back "$name" || true
  done
  return 1
}

deploy() {
  "${compose[@]}" config --quiet || return 1
  "${compose[@]}" build backend frontend || return 1
  if [[ "${1:-}" == migrate ]] && pending_migrations "$previous" "$target"; then
    migrate || return 1
  fi
  "${compose[@]}" up -d --no-build || return 1
  # A changed Caddyfile alone does not recreate the container; an invalid one
  # fails here, before the health checks, and the release is rolled back.
  "${compose[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || return 1
  for _ in {1..60}; do
    if curl --fail --silent --show-error --max-time 10 "https://$domain/api/health/ready" >/dev/null 2>&1 &&
       curl --fail --silent --show-error --max-time 10 "https://$domain/api/products?limit=1" >/dev/null 2>&1 &&
       curl --fail --silent --show-error --max-time 10 "https://$domain/" >/dev/null 2>&1 &&
       curl --fail --silent --show-error --max-time 10 "https://$domain/catalog" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

if ! deploy migrate; then
  echo "Deployment $target failed; restoring $previous" >&2
  "${compose[@]}" ps >&2 || true
  echo "$target" > "$FAILED_FILE"
  git checkout -q -f --detach "$previous"
  deploy || echo "Rollback also failed; manual intervention required" >&2
  exit 1
fi

echo "$target" > "$STATE_FILE"
rm -f "$FAILED_FILE"
echo "Deployed $target successfully"

# The systemd units run copies in /usr/local/sbin, installed by hand once — so
# a change to the watchdog or the backup never reached the server (the backup
# there was a month older than the repository's). Refreshed from the release
# that just passed its health checks; this script's own new copy takes effect
# from the next run.
for pair in auto-deploy.sh:construction-tools-auto-deploy \
            watchdog.sh:construction-tools-watchdog \
            backup-db.sh:construction-tools-backup; do
  src="$APP_DIR/deploy/${pair%%:*}" dst="/usr/local/sbin/${pair##*:}"
  if [[ -f "$src" ]] && ! cmp -s "$src" "$dst"; then
    install -m 0755 "$src" "$dst.new" && mv -f "$dst.new" "$dst" && echo "Updated $dst"
  fi
done
docker image prune -f >/dev/null
docker builder prune -af --keep-storage 1GB >/dev/null || true
