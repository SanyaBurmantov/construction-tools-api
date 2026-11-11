---
paths:
  - "backend/prisma/**"
  - "**/check-migrations.mjs"
  - "deploy/backup*.sh"
  - "deploy/db-app-role.sh"
  - "deploy/auto-deploy.sh"
  - "deploy/watchdog.sh"
---

# Database, migrations and backups

Prisma migrations (expand → contract), deploy-time migration step, backups and restore drills, the DDL-less app role.

- Schema is in `backend/prisma/schema.prisma`. Migrations in
  `backend/prisma/migrations`, starting from a squashed baseline
  `00000000000000_init`. The original pre-baseline migrations are archived in
  `backend/prisma/_migrations_archive_pre_baseline/` and are **not** applied.

- Add schema changes as new migrations and commit them. Never re-introduce
  `prisma db push` for prod.

- **Expand → contract.** A failed release rolls back to the previous images
  in seconds, on the *already-migrated* schema — so a migration must leave
  the previous code working: add columns nullable or with a default, drop or
  rename only in a later release once nothing reads the old one.
  `scripts/check-migrations.mjs` fails CI on DROP/RENAME/TYPE/SET NOT NULL/
  required ADD COLUMN in migrations newer than its `BASELINE`; a statement
  that is really safe is allowed by `-- migration-safety: <why>` in the file.

- Prod containers run `prisma migrate deploy` on start (backend Dockerfile CMD),
  but the auto-deploy applies new migrations first, as a separate step: a DB
  backup, `compose run backend npx prisma migrate deploy`, and on failure
  `migrate resolve --rolled-back` before the release is abandoned — so a broken
  migration never replaces the running containers or leaves P3009 behind.
  After a good release it also refreshes its own copies in `/usr/local/sbin`
  (auto-deploy, watchdog, backup). The watchdog alerts when the newest backup
  is older than 26 h or the disk has under 2 GB free. **Backups are also
  off-site**: `deploy/backup-db.sh` uploads every dump to S3 (hoster.by
  MinIO, `S3_BACKUP_*`; `daily/` 14 days, `monthly/` 180 days, expiry set by
  the script) and stamps `/var/lib/construction-tools/backup-s3.ok` after a
  size-verified upload — the watchdog alerts when that is over 26 h old. A
  failed upload never fails the backup: auto-deploy runs it before migrations.
  Next to each dump it uploads `config-*.tar.gz` (`.env.prod` + Caddy's
  `/data` volume with the TLS certificates) — a dump alone does not rebuild
  the server. It is size-verified and stamps its own
  `backup-config-s3.ok`; the watchdog alerts when that is over 26 h old. The script reads the shared `S3_ENDPOINT/S3_ACCESS_KEY/
  S3_SECRET_KEY` (old `S3_BACKUP_*` names still win) and `S3_BACKUP_BUCKET`.
  It refuses a backup bucket equal to `S3_MEDIA_BUCKET`, and the worker
  refuses a media bucket equal to `S3_BACKUP_BUCKET` — the media bucket is
  made public-read, so one typo would publish every dump.

- **A backup is only a backup once it has been restored.**
  `deploy/backup-drill.sh` (`construction-tools-backup-drill.timer`,
  Sundays 05:10, installed and enabled by auto-deploy) restores the newest
  dump into a throwaway capped Postgres container (384 MB, 0.75 CPU,
  nice/ionice, refuses without ~8× the dump in free disk), compares row
  counts of the key tables with the live DB (≥ 97%) and the migration
  history, records the restore time (our RTO for a lost database), removes
  everything and reports ✅/🔴 to the alerts topic. The watchdog alerts when
  no drill has passed for 8 days. Never writes to the live database.

- **The app can run as a role without DDL rights** (opt-in, audit
  2026-11-03): with `DB_APP_USER`/`DB_APP_PASSWORD` in `.env.prod` and
  `deploy/db-app-role.sh` run once, API and worker connect as that role (data
  rights, `pg_read_all_stats` and `pg_stat_statements_reset` for «Скорость»,
  default privileges for tables future migrations create), the API skips
  `migrate deploy` at boot (`MIGRATE_ON_BOOT=false`), and auto-deploy runs
  migrations as the owner in the one-off container only. Without the
  variables everything connects as `DB_USER`, as before.
