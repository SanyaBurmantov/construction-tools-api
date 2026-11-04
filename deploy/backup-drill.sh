#!/usr/bin/env bash
# Backup drill: a backup nobody has restored is a hope, not a backup.
#
# Weekly (construction-tools-backup-drill.timer, Sunday 05:10 — after the
# 03:30 dump, at the quietest hour): restores the newest local dump into a
# throwaway Postgres container, compares row counts of the tables that matter
# with the live database, records how long the restore took (that is our RTO
# for "the database is gone"), removes everything it created, and reports to
# the Telegram alerts topic — a short ✅ when it worked, a 🔴 when it did not.
# The success stamp ($state_dir/backup-drill.ok) is what watchdog.sh checks:
# no successful drill for 8 days is an alert of its own.
#
# Never touches the live database except for read-only SELECT count(*). The
# container is capped (memory, CPU, nice/ionice) so the storefront keeps its
# share of a 2-core box, and the drill refuses to start without enough disk.
set -Eeuo pipefail

app_dir=/opt/construction-tools/app
backup_dir=${DRILL_BACKUP_DIR:-/opt/construction-tools/backups}
state_dir=/var/lib/construction-tools
container=construction-tools-backup-drill
volume=construction-tools-backup-drill-data
# Restored rows may lag the live ones by a day of growth; less than this share
# of the live count means the dump is missing data.
min_share=${DRILL_MIN_SHARE:-0.97}
tables=(Product SourceProduct Category Brand "Order" OrderItem "User" Review PriceHistory)

cd "$app_dir"
env_value() {
  [[ -r .env.prod ]] || return 0
  sed -n "s/^$1=//p" .env.prod | head -1 | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
db_user=$(env_value DB_USER); db_user=${db_user:-postgres}
db_name=$(env_value DB_NAME); db_name=${db_name:-construction_tools}
tg_token=$(env_value TELEGRAM_BOT_TOKEN)
tg_alert_chat=$(env_value TELEGRAM_ALERT_CHAT_ID)
tg_chat=${tg_alert_chat:-$(env_value TELEGRAM_CHAT_ID)}
tg_thread=$(env_value TELEGRAM_ALERT_THREAD_ID)
[[ -n "$tg_thread" || -n "$tg_alert_chat" ]] || tg_thread=$(env_value TELEGRAM_THREAD_ID)

notify() {
  echo "$1"
  [[ -n "$tg_token" && -n "$tg_chat" ]] || return 0
  local args=(--data-urlencode "chat_id=$tg_chat" --data-urlencode "text=$1")
  [[ -n "$tg_thread" ]] && args+=(--data-urlencode "message_thread_id=$tg_thread")
  curl -fsS --max-time 15 -o /dev/null "https://api.telegram.org/bot$tg_token/sendMessage" "${args[@]}" 2>/dev/null || true
}

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
fail() {
  notify "🔴 Учения бэкапа не прошли: $1. Бэкап, который не восстанавливается, — не бэкап; стоит разобраться (journalctl -u construction-tools-backup-drill)."
  exit 1
}
trap cleanup EXIT
cleanup

dump=$(find "$backup_dir" -maxdepth 1 -name 'database-*.sql.gz' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
[[ -n "$dump" ]] || fail "в $backup_dir нет ни одного дампа"
dump_mb=$(( $(stat -c %s "$dump") / 1048576 ))

# A gzip'd SQL dump restores to roughly 6–8× its size with indexes; keep 2 GB
# on top so the live database never runs the disk dry.
need_mb=$(( dump_mb * 8 + 2048 ))
free_mb=$(( $(df -Pk /var/lib/docker | awk 'NR == 2 { print $4 }') / 1024 ))
(( free_mb >= need_mb )) || fail "мало места на диске: свободно $free_mb МБ, нужно ~$need_mb МБ для дампа $(basename "$dump") ($dump_mb МБ)"

gzip -t "$dump" || fail "архив $(basename "$dump") повреждён (gzip -t)"

started=$(date +%s)
docker run -d --name "$container" \
  --memory 512m --cpus 0.75 \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=drill -e POSTGRES_DB=drill \
  -v "$volume:/var/lib/postgresql/data" \
  postgres:15-alpine \
  postgres -c shared_buffers=64MB -c maintenance_work_mem=64MB \
           -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  >/dev/null || fail "не запустился временный Postgres"

for _ in {1..60}; do
  docker exec "$container" pg_isready -U drill -d drill >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$container" pg_isready -U drill -d drill >/dev/null 2>&1 || fail "временный Postgres не ответил за 2 минуты"

# The dump comes from `pg_dump --no-owner --no-privileges`: plain SQL. Any
# error stops the restore, so a half-restored database never "passes".
if ! nice -n 15 ionice -c3 gunzip -c "$dump" |
    docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U drill -d drill >/dev/null 2>"$state_dir/backup-drill.err"; then
  fail "psql остановился на ошибке: $(tail -c 300 "$state_dir/backup-drill.err" | tr '\n' ' ')"
fi
restore_s=$(( $(date +%s) - started ))

live() {
  docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db \
    psql -U "$db_user" -d "$db_name" -Atc "$1"
}
restored() {
  docker exec "$container" psql -U drill -d drill -Atc "$1"
}

report=()
for table in "${tables[@]}"; do
  q="SELECT count(*) FROM \"${table//\"/}\""
  r=$(restored "$q") || fail "в восстановленной базе нет таблицы $table"
  l=$(live "$q") || fail "не удалось прочитать $table в живой базе"
  if (( l > 0 )) && ! awk -v r="$r" -v l="$l" -v m="$min_share" 'BEGIN { exit !(r >= l * m) }'; then
    fail "в восстановленной таблице $table $r строк, в живой $l — дамп неполный"
  fi
  report+=("${table//\"/}: $r")
done

q='SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'
r_mig=$(restored "$q") || fail "в восстановленной базе нет истории миграций"
l_mig=$(live "$q")
# A release between the dump and the drill may have added migrations since.
(( r_mig <= l_mig && l_mig - r_mig <= 3 )) || fail "миграций в дампе $r_mig, в живой базе $l_mig"

date -u +%FT%TZ > "$state_dir/backup-drill.ok"
rm -f "$state_dir/backup-drill.err"
minutes=$(( (restore_s + 59) / 60 ))
summary=$(printf '%s, ' "${report[@]:0:5}")
notify "✅ Учения бэкапа: дамп $(basename "$dump") ($dump_mb МБ) восстановлен за ~$minutes мин, данные сходятся с живой базой. ${summary%, }."
