#!/usr/bin/env bash
set -Eeuo pipefail

app_dir=/opt/construction-tools/app
backup_dir=/opt/construction-tools/backups
state_dir=/var/lib/construction-tools
mkdir -p "$backup_dir" "$state_dir"
chmod 700 "$backup_dir" "$state_dir"

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
name="database-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
file="$backup_dir/$name"
tmp="$file.tmp"
trap 'rm -f "$tmp"' EXIT

docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db \
  pg_dump --no-owner --no-privileges -U "$db_user" "$db_name" | gzip -1 > "$tmp"
gzip -t "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
# Three days of local dumps while S3 is not confirmed; once this dump is
# off-site only it stays (see prune_local below) — six 400 MB dumps were
# 2.3 GB of a 20 GB disk with 2.7 GB free.
find "$backup_dir" -maxdepth 1 -name 'database-*.sql.gz' -mtime +3 -delete
echo "Database backup saved: $file"

# The newest dump stays on disk (a restore after a bad migration should not
# wait for a 400 MB download); every older one has a verified copy in S3.
prune_local() {
  find "$backup_dir" -maxdepth 1 -name 'database-*.sql.gz' ! -name "$name" -delete
}

# --- off-site copy (S3) -------------------------------------------------------
# The local copies sit on the disk of the database they back up: a lost disk
# or server takes both. Every dump also goes to S3 (hoster.by MinIO for
# gost.by) under daily/, and the first one of each month is copied server-side
# to monthly/. Retention is the bucket's lifecycle rule, re-applied on every
# run so nobody has to set it up by hand: daily/ S3_BACKUP_DAILY_DAYS (14),
# monthly/ S3_BACKUP_MONTHLY_DAYS (180).
#
# An upload failure does not fail the script: the local backup is good, and
# auto-deploy runs this before a migration — an S3 outage must not block a
# release. A successful upload stamps $state_dir/backup-s3.ok instead, and
# watchdog.sh alerts when that stamp is older than 26 h.
# One key pair for the app's photos and the backups (S3_*); the older
# S3_BACKUP_* names still win when set.
first_value() {
  local k v
  for k in "$@"; do
    v=$(env_value "$k")
    if [[ -n "$v" ]]; then echo "$v"; return 0; fi
  done
  return 0 # none set: empty, not a failure (set -e)
}
s3_endpoint=$(first_value S3_BACKUP_ENDPOINT S3_ENDPOINT)
s3_bucket=$(env_value S3_BACKUP_BUCKET)
s3_key=$(first_value S3_BACKUP_ACCESS_KEY S3_ACCESS_KEY)
s3_secret=$(first_value S3_BACKUP_SECRET_KEY S3_SECRET_KEY)
s3_region=$(first_value S3_BACKUP_REGION S3_REGION)
s3_region=${s3_region:-us-east-1}
daily_days=$(env_value S3_BACKUP_DAILY_DAYS)
monthly_days=$(env_value S3_BACKUP_MONTHLY_DAYS)
daily_days=${daily_days:-14}
monthly_days=${monthly_days:-180}

if [[ -z "$s3_endpoint" || -z "$s3_bucket" || -z "$s3_key" || -z "$s3_secret" ]]; then
  echo "S3 endpoint/keys or S3_BACKUP_BUCKET not set; off-site copy skipped"
  exit 0
fi
s3_endpoint=${s3_endpoint%/}
base="$s3_endpoint/$s3_bucket"

# The credentials go to curl on stdin (-K -), never on its command line,
# where any local user could read them in `ps`.
s3() {
  printf 'user = "%s:%s"\n' "$s3_key" "$s3_secret" |
    curl -K - -sS --fail-with-body --retry 3 --retry-all-errors --connect-timeout 20 \
      --aws-sigv4 "aws:amz:$s3_region:s3" -H 'x-amz-content-sha256: UNSIGNED-PAYLOAD' "$@"
}

upload() {
  # Bucket: created on the first run; 409 = it is already ours.
  local code
  code=$(printf 'user = "%s:%s"\n' "$s3_key" "$s3_secret" |
    curl -K - -sS -o /dev/null -w '%{http_code}' --connect-timeout 20 \
      --aws-sigv4 "aws:amz:$s3_region:s3" -X PUT "$base") || return 1
  [[ "$code" == 200 || "$code" == 409 ]] || { echo "S3: bucket check answered $code" >&2; return 1; }

  local lifecycle md5
  lifecycle="<LifecycleConfiguration>\
<Rule><ID>daily</ID><Status>Enabled</Status><Filter><Prefix>daily/</Prefix></Filter><Expiration><Days>$daily_days</Days></Expiration></Rule>\
<Rule><ID>monthly</ID><Status>Enabled</Status><Filter><Prefix>monthly/</Prefix></Filter><Expiration><Days>$monthly_days</Days></Expiration></Rule>\
</LifecycleConfiguration>"
  md5=$(printf '%s' "$lifecycle" | openssl md5 -binary | base64)
  s3 -o /dev/null -X PUT -H "Content-MD5: $md5" -H 'Content-Type: application/xml' \
    --data-binary "$lifecycle" "$base?lifecycle=" ||
    echo "S3: lifecycle rule not applied; old copies will not expire" >&2

  s3 -o /dev/null --max-time 3600 -H 'Content-Type: application/gzip' \
    -T "$file" "$base/daily/$name" || return 1

  # Verify what landed rather than trust the 200.
  local local_size remote_size
  local_size=$(stat -c %s "$file")
  remote_size=$(s3 -I "$base/daily/$name" | tr -d '\r' | awk 'tolower($1) == "content-length:" { print $2 }')
  if [[ "$remote_size" != "$local_size" ]]; then
    echo "S3: size mismatch for daily/$name (local $local_size, remote ${remote_size:-none})" >&2
    return 1
  fi
  echo "Database backup uploaded: $base/daily/$name"

  local month
  month=${name:9:6}
  if ! s3 "$base?list-type=2&prefix=monthly/database-$month" | grep -q '<Key>'; then
    s3 -o /dev/null -X PUT -H "x-amz-copy-source: /$s3_bucket/daily/$name" "$base/monthly/$name" &&
      echo "Monthly copy: $base/monthly/$name" ||
      echo "S3: monthly copy failed; the next run tries again" >&2
  fi
}

# The dump alone does not bring the site back on a new server: .env.prod holds
# every key and password, and Caddy's volume the TLS certificates (re-issuing
# them all at once can hit Let's Encrypt's rate limit). A few KB, kept as long
# as the daily dumps. Its failure is logged but does not void the stamp —
# the stamp is about the database.
upload_config() {
  local caddy_data archive cname
  cname="config-${name#database-}"
  cname="${cname%.sql.gz}.tar.gz"
  archive="$backup_dir/$cname"
  caddy_data=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' \
    construction-tools-caddy 2>/dev/null || true)
  tar -czf "$archive" -C "$app_dir" .env.prod \
    ${caddy_data:+-C "$(dirname "$caddy_data")" "$(basename "$caddy_data")"} || return 1
  chmod 600 "$archive"
  s3 -o /dev/null -H 'Content-Type: application/gzip' -T "$archive" "$base/daily/$cname" || {
    rm -f "$archive"
    return 1
  }
  rm -f "$archive"
  echo "Config backup uploaded: $base/daily/$cname"
}

if upload; then
  touch "$state_dir/backup-s3.ok"
  prune_local
  upload_config || echo "S3: config backup (.env.prod, certificates) failed" >&2
else
  echo "S3 upload failed; the local backup is kept" >&2
fi
