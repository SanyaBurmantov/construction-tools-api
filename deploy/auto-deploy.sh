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
domain=$(sed -n 's/^DOMAIN=//p' "$ENV_FILE" | head -1)

deploy() {
  "${compose[@]}" config --quiet || return 1
  "${compose[@]}" build backend frontend || return 1
  "${compose[@]}" up -d --no-build || return 1
  for _ in {1..60}; do
    if curl --fail --silent --show-error --max-time 10 "https://$domain/api/health/ready" >/dev/null 2>&1 &&
       curl --fail --silent --show-error --max-time 10 "https://$domain/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

if ! deploy; then
  echo "Deployment $target failed; restoring $previous" >&2
  "${compose[@]}" ps >&2
  echo "$target" > "$FAILED_FILE"
  git checkout -q -f --detach "$previous"
  deploy || echo "Rollback also failed; manual intervention required" >&2
  exit 1
fi

echo "$target" > "$STATE_FILE"
rm -f "$FAILED_FILE"
echo "Deployed $target successfully"
docker image prune -f >/dev/null
docker builder prune -af --keep-storage 1GB >/dev/null || true
