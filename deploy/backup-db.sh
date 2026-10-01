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
db_user=$(sed -n 's/^DB_USER=//p' .env.prod | head -1)
db_name=$(sed -n 's/^DB_NAME=//p' .env.prod | head -1)
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
