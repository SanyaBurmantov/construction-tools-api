#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/construction-tools/app
ENV_FILE="$APP_DIR/.env.prod"
LOCK_FILE=/run/lock/construction-tools-deploy.lock
STATE_FILE=/opt/construction-tools/deployed.sha
FAILED_FILE=/opt/construction-tools/failed.sha
# "<sha> <epoch>": when this server first saw a release it is waiting on CI for.
PENDING_FILE=/opt/construction-tools/pending.sha
# A release CI did not pass, already reported. Not FAILED_FILE: a re-run job
# that goes green should still deploy it.
REJECTED_FILE=/opt/construction-tools/rejected.sha

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0
cd "$APP_DIR"

env_value() {
  # Plain KEY=value lookup like watchdog.sh; never `source` the file. Quotes
  # stripped: DOMAIN="gost.by" made every health curl fail, so each release
  # was marked failed and rolled back.
  [[ -r "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# Images are built by GitHub Actions (.github/workflows/ci.yml, jobs `image`
# and `images-prod`) and pulled here: a Nuxt build on this 2-core box pushed
# the load to 16 and made every release 10–15 minutes of a slow storefront.
# Building on the server is only the fallback for when GitHub cannot say.
REGISTRY=$(env_value IMAGE_REGISTRY); REGISTRY=${REGISTRY:-ghcr.io/sanyaburmantov}
GITHUB_REPO=$(env_value GITHUB_REPO); GITHUB_REPO=${GITHUB_REPO:-SanyaBurmantov/construction-tools-api}
# How long a release waits for its CI images before it is built here instead.
IMAGE_WAIT_SECONDS=$(env_value DEPLOY_IMAGE_WAIT_SECONDS); IMAGE_WAIT_SECONDS=${IMAGE_WAIT_SECONDS:-1800}
APPS=(backend frontend)
# The container each image runs in: what is running is what a rollback restores.
declare -A CONTAINER=([backend]=construction-tools-api [frontend]=construction-tools-front)

tg_token=$(env_value TELEGRAM_BOT_TOKEN)
tg_alert_chat=$(env_value TELEGRAM_ALERT_CHAT_ID)
tg_chat=${tg_alert_chat:-$(env_value TELEGRAM_CHAT_ID)}
tg_thread=$(env_value TELEGRAM_ALERT_THREAD_ID)
[[ -n "$tg_thread" || -n "$tg_alert_chat" ]] || tg_thread=$(env_value TELEGRAM_THREAD_ID)

notify() {
  # Same alerts topic as the watchdog. A release that CI rejected used to have
  # no equivalent (the server built whatever was pushed); now nothing would
  # happen on the site, so say so. Never fails the deploy.
  [[ -n "$tg_token" && -n "$tg_chat" ]] || return 0
  local args=(--data-urlencode "chat_id=$tg_chat" --data-urlencode "text=$1")
  [[ -n "$tg_thread" ]] && args+=(--data-urlencode "message_thread_id=$tg_thread")
  curl -fsS --max-time 15 -o /dev/null "https://api.telegram.org/bot$tg_token/sendMessage" "${args[@]}" 2>/dev/null || true
}

if ! GIT_TERMINAL_PROMPT=0 timeout 30s git fetch --quiet --depth=1 origin refs/heads/prod; then
  echo "GitHub prod branch is not available yet"
  exit 0
fi

target=$(git rev-parse FETCH_HEAD)
if [[ "$target" == "$(cat "$STATE_FILE" 2>/dev/null || true)" ||
      "$target" == "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]]; then
  exit 0
fi

# ready | wait | rejected | unknown, from the `images-prod` check of the commit.
ci_state() {
  local json
  json=$(curl -fsS --max-time 15 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$GITHUB_REPO/commits/$1/check-runs?check_name=images-prod&filter=latest" 2>/dev/null) || {
    echo unknown
    return
  }
  if grep -qE '"conclusion": *"success"' <<<"$json"; then
    echo ready
  elif grep -qE '"status": *"(queued|in_progress|waiting|requested|pending)"' <<<"$json"; then
    echo wait
  elif grep -qE '"conclusion": *"[a-z_]+"' <<<"$json"; then
    # failure, cancelled, skipped (a test or lint job failed before it)…
    echo rejected
  else
    # No such check yet: the workflow has not started.
    echo unknown
  fi
}

first_seen() {
  local sha since
  [[ -r "$PENDING_FILE" ]] && read -r sha since <"$PENDING_FILE" || true
  if [[ "${sha:-}" != "$1" || ! "${since:-}" =~ ^[0-9]+$ ]]; then
    since=$(date +%s)
    echo "$1 $since" >"$PENDING_FILE"
  fi
  echo "$since"
}

build_mode=pull
state=$(ci_state "$target")
case "$state" in
  ready) ;;
  rejected)
    rm -f "$PENDING_FILE"
    if [[ "$(cat "$REJECTED_FILE" 2>/dev/null || true)" != "$target" ]]; then
      echo "CI did not pass for $target; not deploying it" >&2
      echo "$target" >"$REJECTED_FILE"
      notify "⛔ Выкатка ${target:0:7} не начата: проверки в GitHub Actions не прошли. На сайте остаётся прежняя версия."
    fi
    exit 0
    ;;
  *)
    waited=$(($(date +%s) - $(first_seen "$target")))
    if ((waited < IMAGE_WAIT_SECONDS)); then
      echo "Waiting for CI images of ${target:0:7} ($state, ${waited}s)"
      exit 0
    fi
    echo "No CI result for $target after ${waited}s ($state); building on the server" >&2
    build_mode=build
    ;;
esac
rm -f "$PENDING_FILE"

previous=$(cat "$STATE_FILE" 2>/dev/null || git rev-parse HEAD)
git checkout -q -f -B prod "$target"
compose=(docker compose --parallel 1 --env-file "$ENV_FILE" -f docker-compose.prod.yml)
domain=$(env_value DOMAIN)

# Keep what is running now as :rollback, so a failed release goes back in
# seconds instead of rebuilding the old commit. Taken from the containers, not
# from :latest — a release that was pulled but never started moved :latest.
keep_rollback_images() {
  local app image
  for app in "${APPS[@]}"; do
    image=$(docker inspect --format '{{.Image}}' "${CONTAINER[$app]}" 2>/dev/null) || continue
    docker tag "$image" "construction-tools-$app:rollback"
  done
}

restore_rollback_images() {
  local app
  for app in "${APPS[@]}"; do
    docker image inspect "construction-tools-$app:rollback" >/dev/null 2>&1 || return 1
  done
  for app in "${APPS[@]}"; do
    docker tag "construction-tools-$app:rollback" "construction-tools-$app:latest" || return 1
  done
}

pull_images() {
  local app ref
  for app in "${APPS[@]}"; do
    ref="$REGISTRY/construction-tools-$app:$1"
    timeout 600s docker pull --quiet "$ref" >/dev/null || return 1
    docker tag "$ref" "construction-tools-$app:latest" || return 1
    # Only the local names stay; the layers are kept by them.
    docker rmi "$ref" >/dev/null 2>&1 || true
  done
}

prepare_images() {
  if [[ "$build_mode" == pull ]]; then
    if pull_images "$1"; then
      echo "Pulled CI images for ${1:0:7}"
      return 0
    fi
    # The check said the images exist, so the registry or its visibility is
    # the problem (a private package needs `docker login ghcr.io` here).
    echo "Pulling images for $1 failed; building on the server instead" >&2
    build_mode=build
  fi
  "${compose[@]}" build backend frontend
}

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

start_and_check() {
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

deploy() {
  "${compose[@]}" config --quiet || return 1
  prepare_images "$1" || return 1
  if [[ "${2:-}" == migrate ]] && pending_migrations "$previous" "$target"; then
    migrate || return 1
  fi
  start_and_check
}

keep_rollback_images
if ! deploy "$target" migrate; then
  echo "Deployment $target failed; restoring $previous" >&2
  "${compose[@]}" ps >&2 || true
  echo "$target" >"$FAILED_FILE"
  git checkout -q -f --detach "$previous"
  if restore_rollback_images && start_and_check; then
    echo "Restored the previous images"
  else
    # No kept images (first release of this script) or they did not come up:
    # the old way, rebuilding the previous commit here.
    build_mode=build
    deploy "$previous" || echo "Rollback also failed; manual intervention required" >&2
  fi
  notify "⚠️ Выкатка ${target:0:7} не прошла (сборка, миграция или проверки здоровья), вернул ${previous:0:7}. Подробности: journalctl -u construction-tools-deploy"
  exit 1
fi

echo "$target" >"$STATE_FILE"
rm -f "$FAILED_FILE" "$REJECTED_FILE"
echo "Deployed $target successfully ($build_mode)"

# The systemd units run copies in /usr/local/sbin, installed by hand once — so
# a change to the watchdog or the backup never reached the server (the backup
# there was a month older than the repository's). Refreshed from the release
# that just passed its health checks; this script's own new copy takes effect
# from the next run.
for pair in auto-deploy.sh:construction-tools-auto-deploy \
            watchdog.sh:construction-tools-watchdog \
            backup-db.sh:construction-tools-backup \
            backup-drill.sh:construction-tools-backup-drill; do
  src="$APP_DIR/deploy/${pair%%:*}" dst="/usr/local/sbin/${pair##*:}"
  if [[ -f "$src" ]] && ! cmp -s "$src" "$dst"; then
    install -m 0755 "$src" "$dst.new" && mv -f "$dst.new" "$dst" && echo "Updated $dst"
  fi
done
# Units that ship with the repository and are installed by it (the older
# deploy/backup/watchdog units were installed by hand and stay so).
units_changed=0
for unit in construction-tools-backup-drill.service construction-tools-backup-drill.timer; do
  src="$APP_DIR/deploy/$unit" dst="/etc/systemd/system/$unit"
  if [[ -f "$src" ]] && ! cmp -s "$src" "$dst"; then
    install -m 0644 "$src" "$dst" && echo "Updated $dst" && units_changed=1
  fi
done
if ((units_changed)); then
  systemctl daemon-reload
  systemctl enable --now construction-tools-backup-drill.timer || true
fi
# Untagged old releases go; :latest and :rollback stay.
docker image prune -f >/dev/null
docker builder prune -af --keep-storage 1GB >/dev/null || true
