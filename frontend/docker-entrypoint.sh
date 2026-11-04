#!/bin/sh
# The storefront runs as `node`, not root (audit 2026-11-03): a compromised
# render must not own the container. The page cache volume was created by the
# root process of earlier images, so what in it is still root's is handed
# over once (later starts find nothing to change), and only then does the
# server start — as `node`, with root's rights dropped for good.
set -eu
cache=${NUXT_CACHE_DIR:-}
if [ -n "$cache" ]; then
  mkdir -p "$cache"
  find "$cache" -maxdepth 1 ! -user node -exec chown -R node:node {} + 2>/dev/null || true
fi
if command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid=node --regid=node --init-groups -- node .output/server/index.mjs
fi
# util-linux is essential in Debian, so this is not expected — but a missing
# tool must not take the storefront down: run as before and say so.
echo "docker-entrypoint: setpriv not found, starting as root" >&2
exec node .output/server/index.mjs
