-- Per-query timing for /admin/performance («Скорость»). The library itself is
-- loaded by the server (shared_preload_libraries in docker-compose.prod.yml);
-- the extension only adds the views, so this runs even before that restart.
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
