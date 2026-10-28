#!/usr/bin/env bash
# External uptime check for gost.by — run from GitHub Actions every 5 minutes
# (.github/workflows/uptime.yml), i.e. from outside the server: the on-box
# watchdog cannot notice the box itself, its network, DNS or TLS going away.
#
# Prints one line per check and exits 1 when anything failed. Each check gets
# three tries ten seconds apart, so a single slow response or a deploy's
# restart is not an outage.
#
#   SITE_URL=https://gost.by deploy/uptime-check.sh
set -uo pipefail

SITE_URL="${SITE_URL:-https://gost.by}"
SITE_URL="${SITE_URL%/}"
HOST="${SITE_URL#https://}"
HOST="${HOST%%/*}"
CERT_MIN_DAYS="${CERT_MIN_DAYS:-14}"
ATTEMPTS="${ATTEMPTS:-3}"
PAUSE="${PAUSE:-10}"

failures=()

# check <name> <url> <expected text or empty>
check() {
  local name="$1" url="$2" expect="$3" code body tries=0
  local tmp
  tmp="$(mktemp)"
  while (( tries < ATTEMPTS )); do
    tries=$((tries + 1))
    code="$(curl -sS -L --max-time 25 -A 'gost-uptime-check' -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]] && { [[ -z "$expect" ]] || grep -qi -- "$expect" "$tmp"; }; then
      echo "OK   $name ($url)"
      rm -f "$tmp"
      return 0
    fi
    (( tries < ATTEMPTS )) && sleep "$PAUSE"
  done
  body="$(head -c 200 "$tmp" | tr -d '\r\n' || true)"
  rm -f "$tmp"
  if [[ "$code" == "200" ]]; then
    failures+=("$name: ответ без «$expect» — открывается чужая страница?")
  else
    failures+=("$name: HTTP $code")
  fi
  echo "FAIL $name ($url): HTTP $code ${body:0:120}"
}

# The storefront through Caddy + Nuxt SSR. The text guards against a 200
# from somebody else's server (a wrong DNS record answers 200 too).
check "Главная" "$SITE_URL/" "gost.by"
# A catalogue page: SSR that has to reach the API and the database.
check "Каталог" "$SITE_URL/catalog" "gost.by"
# The API's readiness probe: process up and the database answering.
check "API" "$SITE_URL/api/health/ready" ""

# TLS certificate: Caddy renews it itself; this catches a renewal that
# silently stopped working weeks before browsers start refusing the site.
expiry="$(echo | openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [[ -z "$expiry" ]]; then
  failures+=("Сертификат: не удалось прочитать")
  echo "FAIL certificate: unreadable"
else
  days=$(( ( $(date -d "$expiry" +%s) - $(date +%s) ) / 86400 ))
  if (( days < CERT_MIN_DAYS )); then
    failures+=("Сертификат истекает через $days дн. ($expiry)")
    echo "FAIL certificate: $days days left"
  else
    echo "OK   certificate: $days days left"
  fi
fi

if (( ${#failures[@]} )); then
  printf '%s\n' "${failures[@]}" > "${FAILURES_FILE:-/dev/null}"
  exit 1
fi
exit 0
