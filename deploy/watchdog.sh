#!/usr/bin/env bash
# Host-side watchdog: notices what the backend cannot report about itself —
# the site being unreachable, a container OOM-killed by its mem_limit and
# restarted, or a container stuck unhealthy — and tells Telegram once per
# incident (plus once when it is over). Run by construction-tools-watchdog.timer.
#
# It also heals the one case Docker will not: a container that is running but
# `unhealthy`. `restart: unless-stopped` only reacts to an exit, and a heap OOM
# once left node hung at 100% CPU, "Up (unhealthy)", for 13 hours — the whole
# catalogue a 502 until someone restarted it by hand.
#
# It cannot alert when the host itself is down; keep an external uptime check
# (e.g. UptimeRobot on / and /api/health/ready) for that.
set -Euo pipefail

APP_DIR=${WATCHDOG_APP_DIR:-/opt/construction-tools/app}
ENV_FILE=${WATCHDOG_ENV_FILE:-$APP_DIR/.env.prod}
STATE_DIR=${WATCHDOG_STATE_DIR:-/var/lib/construction-tools}
STATE_FILE="$STATE_DIR/watchdog.state"
LOCK_FILE=${WATCHDOG_LOCK_FILE:-/run/lock/construction-tools-watchdog.lock}
DEPLOY_LOCK=${WATCHDOG_DEPLOY_LOCK:-/run/lock/construction-tools-deploy.lock}

# Consecutive bad runs before an alert (one run ≈ 2 min).
FAIL_THRESHOLD=2
# Quiet runs after a restart before the restart incident is called over.
RESTART_QUIET_RUNS=3
# Consecutive unhealthy runs before the container is restarted, and the minimum
# gap between two restarts of one container (a crash loop is not fixed by more).
HEAL_THRESHOLD=3
HEAL_COOLDOWN_SECONDS=900

# service -> container_name in docker-compose.prod.yml
SERVICES=(db backend frontend caddy)
declare -A CONTAINER=(
  [db]=construction-tools-db
  [backend]=construction-tools-api
  [frontend]=construction-tools-front
  [caddy]=construction-tools-caddy
)

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
exec 8>"$LOCK_FILE"
flock -n 8 || exit 0

# A release in progress recreates containers and briefly takes the site down;
# auto-deploy.sh has its own health gate and rollback. Probe the lock without
# holding it (holding it would make the deploy skip its run).
if [[ -e "$DEPLOY_LOCK" ]] && ! flock -n "$DEPLOY_LOCK" true 2>/dev/null; then
  echo "Deploy in progress; watchdog run skipped"
  exit 0
fi

env_value() {
  # Plain KEY=value lookup like the other deploy scripts; never `source` the file.
  [[ -r "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '\r'
}

domain=$(env_value DOMAIN)
tg_token=$(env_value TELEGRAM_BOT_TOKEN)
# Alerts go to their own chat/topic (orders stay in TELEGRAM_CHAT_ID), same
# fallback as the backend's TelegramService.
tg_alert_chat=$(env_value TELEGRAM_ALERT_CHAT_ID)
tg_chat=${tg_alert_chat:-$(env_value TELEGRAM_CHAT_ID)}
tg_thread=$(env_value TELEGRAM_ALERT_THREAD_ID)
[[ -n "$tg_thread" || -n "$tg_alert_chat" ]] || tg_thread=$(env_value TELEGRAM_THREAD_ID)
host_label=${domain:-$(hostname)}

# --- state: flat key=value file -------------------------------------------
declare -A S=()
if [[ -r "$STATE_FILE" ]]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[a-z0-9_]+$ ]] && S[$k]=$v
  done <"$STATE_FILE"
fi
get() { printf '%s' "${S[$1]:-${2:-}}"; }
save_state() {
  local tmp="$STATE_FILE.tmp" k
  for k in "${!S[@]}"; do printf '%s=%s\n' "$k" "${S[$k]}"; done | sort >"$tmp"
  mv "$tmp" "$STATE_FILE"
}
trap save_state EXIT

now=$(date +%s)
since() {
  local start=$1 d
  d=$(( (now - start) / 60 ))
  if (( d < 60 )); then echo "${d} мин"; else echo "$((d / 60)) ч $((d % 60)) мин"; fi
}

# --- telegram --------------------------------------------------------------
send_telegram() {
  local text="[$host_label] $1"
  echo "ALERT: $text"
  if [[ -z "$tg_token" || -z "$tg_chat" ]]; then
    echo "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set in $ENV_FILE; alert logged only" >&2
    return 0 # nothing to retry; the journal line above is the alert

  fi
  local code
  # The URL (which carries the token) goes through --config on stdin so it
  # never appears in argv / ps, and -s keeps curl from echoing it on error.
  code=$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$tg_token" |
    curl --config - --silent --max-time 10 --output /dev/null --write-out '%{http_code}' \
      --data-urlencode "chat_id=$tg_chat" \
      ${tg_thread:+--data-urlencode "message_thread_id=$tg_thread"} \
      --data-urlencode "text=$text" \
      --data-urlencode "disable_web_page_preview=true" 2>/dev/null) || code=000
  if [[ "$code" != 200 ]]; then
    echo "Telegram send failed (HTTP $code)" >&2
    return 1
  fi
}

mem_report() {
  local out
  out=$(timeout 20s docker stats --no-stream \
    --format '{{.Name}}: {{.MemUsage}} ({{.MemPerc}})' \
    "${CONTAINER[frontend]}" "${CONTAINER[backend]}" 2>/dev/null) || true
  [[ -n "$out" ]] && printf '\nПамять:\n%s' "$out"
}

# --- HTTP checks -----------------------------------------------------------
http_code() {
  curl --silent --output /dev/null --max-time 15 --connect-timeout 5 \
    --write-out '%{http_code}' "$1" 2>/dev/null || true
}

check_http() {
  local key=$1 url=$2 label=$3 code fails
  code=$(http_code "$url")
  [[ -n "$code" ]] || code=000
  fails=$(get "${key}_fails" 0)
  if [[ "$code" == 200 ]]; then
    if [[ "$(get "${key}_alerted" 0)" == 1 ]]; then
      send_telegram "✅ $label снова отвечает 200 (недоступен был $(since "$(get "${key}_since" "$now")"))." || true
    fi
    S[${key}_fails]=0 S[${key}_alerted]=0
    unset 'S[${key}_since]'
    return
  fi
  fails=$((fails + 1))
  S[${key}_fails]=$fails
  [[ -n "$(get "${key}_since")" ]] || S[${key}_since]=$now
  echo "$label: HTTP $code (fail $fails)"
  if (( fails >= FAIL_THRESHOLD )) && [[ "$(get "${key}_alerted" 0)" != 1 ]]; then
    if send_telegram "🔴 $label недоступен: HTTP $code ($fails проверки подряд, $url).$(mem_report)"; then
      S[${key}_alerted]=1
    fi
  fi
}

if [[ -n "$domain" ]]; then
  check_http site "https://$domain/" "Сайт"
  check_http api "https://$domain/api/health/ready" "API"
else
  echo "DOMAIN is not set in $ENV_FILE; HTTP checks skipped" >&2
fi

# --- container checks --------------------------------------------------------
for svc in "${SERVICES[@]}"; do
  name=${CONTAINER[$svc]}
  # id|status|health|restarts|oomkilled|exitcode|finishedAt
  info=$(timeout 20s docker inspect --format \
    '{{.Id}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.State.FinishedAt}}' \
    "$name" 2>/dev/null) || info=""

  if [[ -z "$info" ]]; then
    status=missing health=none restarts="" oom=false exit_code="" finished="" id=""
  else
    IFS='|' read -r id status health restarts oom exit_code finished <<<"$info"
  fi

  # 1) RestartCount grew since the last run -> the container died and docker
  #    restarted it. A new container id (deploy / compose up) resets the count,
  #    so that only re-baselines.
  prev_id=$(get "${svc}_id")
  prev_restarts=$(get "${svc}_restarts")
  if [[ -n "$id" ]]; then
    if [[ "$id" == "$prev_id" && -n "$prev_restarts" ]] && (( restarts > prev_restarts )); then
      delta=$((restarts - prev_restarts))
      S[${svc}_quiet]=0
      if [[ "$(get "${svc}_restart_alerted" 0)" != 1 ]]; then
        if [[ "$oom" == true ]]; then
          cause="OOMKilled — упёрся в mem_limit"
        else
          cause="не OOM, exit code $exit_code"
        fi
        if send_telegram "🟠 Контейнер $svc ($name) перезапустился: +$delta (всего $restarts). Причина: $cause. Последнее падение: ${finished%%.*}Z.$(mem_report)"; then
          S[${svc}_restart_alerted]=1
          S[${svc}_restart_since]=$now
          S[${svc}_restarts]=$restarts
        fi
      else
        S[${svc}_restarts]=$restarts
        echo "$svc restarted again (+$delta, total $restarts, oom=$oom); incident already reported"
      fi
    else
      S[${svc}_restarts]=$restarts
      if [[ "$(get "${svc}_restart_alerted" 0)" == 1 ]]; then
        quiet=$(( $(get "${svc}_quiet" 0) + 1 ))
        S[${svc}_quiet]=$quiet
        if [[ "$id" != "$prev_id" ]]; then
          send_telegram "ℹ️ Контейнер $svc пересоздан (деплой или compose up); инцидент с перезапусками закрыт, счётчик начат заново." || true
          S[${svc}_restart_alerted]=0 S[${svc}_quiet]=0
        elif (( quiet >= RESTART_QUIET_RUNS )) && [[ "$status" == running ]]; then
          send_telegram "✅ Контейнер $svc стабилен: перезапусков нет уже ~$((quiet * 2)) мин (всего $restarts, инцидент длился $(since "$(get "${svc}_restart_since" "$now")"))." || true
          S[${svc}_restart_alerted]=0 S[${svc}_quiet]=0
        fi
      fi
    fi
    S[${svc}_id]=$id
  fi

  # 2) Not running, missing, or unhealthy for FAIL_THRESHOLD runs in a row.
  #    "starting" is the healthcheck's grace period, not a failure.
  if [[ "$status" == running && "$health" != unhealthy ]]; then
    if [[ "$(get "${svc}_bad_alerted" 0)" == 1 ]]; then
      send_telegram "✅ Контейнер $svc снова в порядке (status=$status, health=$health; проблема длилась $(since "$(get "${svc}_bad_since" "$now")"))." || true
    fi
    S[${svc}_bad]=0 S[${svc}_bad_alerted]=0
    unset 'S[${svc}_bad_since]'
  else
    bad=$(( $(get "${svc}_bad" 0) + 1 ))
    S[${svc}_bad]=$bad
    [[ -n "$(get "${svc}_bad_since")" ]] || S[${svc}_bad_since]=$now
    echo "$svc: status=$status health=$health (bad $bad)"
    if [[ "$status" == running && "$health" == unhealthy ]] && (( bad >= HEAL_THRESHOLD )) &&
       (( now - $(get "${svc}_healed_at" 0) >= HEAL_COOLDOWN_SECONDS )); then
      echo "$svc: unhealthy for $bad runs, restarting $name"
      S[${svc}_healed_at]=$now
      if timeout 60s docker restart -t 20 "$name" >/dev/null; then
        send_telegram "🛠 Контейнер $svc ($name) был unhealthy ~$((bad * 2)) мин — перезапущен автоматически.$(mem_report)" || true
      else
        send_telegram "🔴 Контейнер $svc ($name) unhealthy, автоматический перезапуск не удался." || true
      fi
    fi
    if (( bad >= FAIL_THRESHOLD )) && [[ "$(get "${svc}_bad_alerted" 0)" != 1 ]]; then
      detail="status=$status, health=$health"
      [[ "$oom" == true ]] && detail+=", OOMKilled"
      [[ "$status" == exited ]] && detail+=", exit code $exit_code"
      if send_telegram "🔴 Контейнер $svc ($name) неисправен: $detail.$(mem_report)"; then
        S[${svc}_bad_alerted]=1
      fi
    fi
  fi
done

S[last_run]=$now
