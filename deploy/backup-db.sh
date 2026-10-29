#!/usr/bin/env bash
set -Eeuo pipefail

app_dir=/opt/construction-tools/app
backup_dir=/opt/construction-tools/backups
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

available_kb=$(df -Pk "$backup_dir" | awk 'NR == 2 { print $4 }')
if (( available_kb < 1048576 )); then
  echo "Less than 1 GiB free; database backup skipped" >&2
  exit 1
fi

cd "$app_dir"
# Quotes stripped like watchdog.sh's env_value — a quoted DB_USER broke pg_dump.
env_value() {
  sed -n "s/^$1=//p" .env.prod | head -1 | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
db_user=$(env_value DB_USER)
db_name=$(env_value DB_NAME)
file="$backup_dir/database-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
tmp="$file.tmp"
trap 'rm -f "$tmp"' EXIT

docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db \
  pg_dump --no-owner --no-privileges -U "$db_user" "$db_name" | gzip -1 > "$tmp"
gzip -t "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
find "$backup_dir" -maxdepth 1 -name 'database-*.sql.gz' -mtime +3 -delete
echo "Database backup saved: $file"
