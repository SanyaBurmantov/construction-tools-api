#!/bin/sh
# Read-only look at production (gost.by), one entry point so a single
# permission rule covers it. Nothing here changes the server or the database:
# SQL runs with default_transaction_read_only=on.
#
#   prod-check.sh status               release, containers, memory, disk, timers, health
#   prod-check.sh suppliers            can the box reach th-tool.by / dukon.by / tools.by
#   prod-check.sh parsers              queues, last runs, how old the offers are
#   prod-check.sh logs SERVICE [N]     last N (200) log lines: api|worker|front|db|caddy|detector
#   prod-check.sh sql ['SELECT …']     read-only SQL (argument, or stdin when omitted)
#   prod-check.sh catalog OUT.jsonl    every published product as JSON lines (for rule checks)
#
# Password: PROD_SSH_PASS inline (never in a file — the repo is public), or an SSH key.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
P="$DIR/../../claude-edit-products/scripts/prod.sh"
# psql inside the db container, read-only, SQL from stdin.
PSQL="docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000' construction-tools-db sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -v ON_ERROR_STOP=1 -X -q -P pager=off \"\$@\"' psql"
sql() { "$P" "$PSQL $*"; }

case "$1" in
  status)
    "$P" '
      echo "== time: $(date -u "+%F %T UTC")   up: $(uptime -p)   load: $(cut -d" " -f1-3 /proc/loadavg)"
      echo "== release"; for f in deployed failed; do printf "%s: " $f; cat /opt/construction-tools/$f.sha 2>/dev/null || echo "-"; done
      echo "== containers"; docker ps -a --format "{{.Names}}\t{{.Status}}" | sort | column -t -s "$(printf "\t")"
      echo "== memory / cpu"; docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" | sort | column -t -s "$(printf "\t")"
      free -m | sed -n "1,3p"
      echo "== disk"; df -h / | tail -1
      echo "== timers"; systemctl list-timers "construction-tools*" --no-pager 2>/dev/null | sed -n "1,8p" | cut -c1-150
      echo "== stamps"; ls -l --time-style="+%F %H:%M" /var/lib/construction-tools/ 2>/dev/null | tail -n +2 | awk "{print \$6, \$7, \$8}"
      echo "== health"; for u in https://gost.by/ https://gost.by/catalog https://gost.by/api/health/ready; do curl -s -o /dev/null -m 15 -w "%{http_code} %{time_total}s  $u\n" $u; done
    ' ;;
  suppliers)
    "$P" '
      date -u "+%F %T UTC"
      for h in th-tool.by dukon.by tools.by; do
        ip=$(getent ahostsv4 $h | head -1 | cut -d" " -f1)
        ping -c 2 -W 2 $h >/dev/null 2>&1 && pg=ok || pg="no reply"
        t80=$(timeout 6 bash -c "</dev/tcp/$ip/80" 2>/dev/null && echo open || echo "no connect")
        t443=$(timeout 6 bash -c "</dev/tcp/$ip/443" 2>/dev/null && echo open || echo "no connect")
        code=$(curl -s -o /dev/null -m 10 -w "%{http_code}" https://$h/ || true)
        echo "$h ($ip): ping $pg, tcp80 $t80, tcp443 $t443, https $code"
      done
    ' ;;
  parsers)
    sql <<'SQL'
\echo == queues
SELECT 'th-tool.by' AS source, status, count(*) AS urls, max("visitedAt")::timestamp(0) AS last_visited FROM "SitemapsThTools" GROUP BY status
UNION ALL SELECT 'dukon.by', status, count(*), max("visitedAt")::timestamp(0) FROM "SitemapsDukon" GROUP BY status
UNION ALL SELECT 'tools.by', status, count(*), max("visitedAt")::timestamp(0) FROM "SitemapsToolsBy" GROUP BY status
ORDER BY 1, 2;
\echo == jobs
SELECT key, "isRunning" AS running, "lastSuccessAt"::timestamp(0) AS last_success, "lastErrorAt"::timestamp(0) AS last_error,
       "waitingSince"::timestamp(0) AS waiting, left(coalesce("lastError", ''), 60) AS error
FROM "ParserRuntimeStatus" ORDER BY key;
\echo == last 12 runs
SELECT key, status, "startedAt"::timestamp(0) AS started, round("durationMs" / 60000.0, 1) AS min, "errorCount" AS errors,
       left(coalesce(result::text, error, ''), 90) AS result
FROM "ParserRun" ORDER BY "startedAt" DESC LIMIT 12;
\echo == offers of products on sale: how old is the last sync
SELECT s.name AS source, count(*) AS offers,
       count(*) FILTER (WHERE sp."lastSync" > now() - interval '2 days') AS fresh_2d,
       count(*) FILTER (WHERE sp."lastSync" < now() - interval '7 days') AS older_7d,
       min(sp."lastSync")::date AS oldest, max(sp."lastSync")::timestamp(0) AS newest
FROM "SourceProduct" sp JOIN "Source" s ON s.id = sp."sourceId" JOIN "Product" p ON p.id = sp."productId"
WHERE p.status = 'PUBLISHED' GROUP BY s.name ORDER BY 2 DESC;
\echo == products by status
SELECT status, "statusSource", count(*) FROM "Product" GROUP BY 1, 2 ORDER BY 3 DESC;
SQL
    ;;
  logs)
    case "$2" in api|worker|front|db|caddy|detector) ;; *) echo "service: api|worker|front|db|caddy|detector" >&2; exit 1 ;; esac
    n=$(printf '%s' "${3:-200}" | tr -cd '0-9')
    "$P" "docker logs --tail ${n:-200} construction-tools-$2 2>&1" ;;
  sql)
    if [ -n "$2" ]; then printf '%s\n' "$2" | sql; else sql; fi ;;
  catalog)
    [ -n "$2" ] || { echo "usage: prod-check.sh catalog OUT.jsonl" >&2; exit 1; }
    sql -At > "$2" <<'SQL'
COPY (
  SELECT json_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'sku', p.sku, 'model', p.model, 'barcode', p.barcode,
    'brand', b.name, 'categoryId', p."categoryId", 'category', c.name, 'price', p."priceValue",
    'supplierName', o.name, 'supplierSku', o.sku, 'source', o.source)
  FROM "Product" p
  LEFT JOIN "Brand" b ON b.id = p."brandId"
  LEFT JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN LATERAL (
    SELECT sp.name, sp.sku, s.code AS source FROM "SourceProduct" sp JOIN "Source" s ON s.id = sp."sourceId"
    WHERE sp."productId" = p.id ORDER BY sp."createdAt", sp.id LIMIT 1) o ON true
  WHERE p.status = 'PUBLISHED'
) TO STDOUT;
SQL
    echo "$(wc -l < "$2") products → $2" ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
