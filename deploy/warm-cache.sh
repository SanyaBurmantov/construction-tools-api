#!/usr/bin/env bash
# Warms the storefront's page cache after a release.
#
# Nitro's cache is per frontend build (a cached page points at that build's
# /_nuxt/ hashes), so every deploy started cold: the first visitor of each
# page — and every crawler — waited for a full server render, a product page
# ~1–2 s. auto-deploy.sh starts this right after a release passes its health
# checks, as its own transient unit (systemd-run), so the deploy does not
# wait for it.
#
# What is warmed, one page at a time with a pause (never a burst on the
# 2-core box): the home page, the catalogue and the info pages, the curated
# header strip and every root category, the home page's «Выбирают
# покупатели» products and the first products of each root category — the
# pages a visitor reaches in one or two clicks. Bounded by WARM_MAX_PAGES.
# Requests go through the public URL like a visitor's (Caddy, then Nitro).
set -Eeuo pipefail

app_dir=${APP_DIR:-/opt/construction-tools/app}
env_value() {
  [[ -r "$app_dir/.env.prod" ]] || return 0
  sed -n "s/^$1=//p" "$app_dir/.env.prod" | head -1 | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
domain=$(env_value DOMAIN)
base="https://${domain:-gost.by}"
max_pages=${WARM_MAX_PAGES:-220}
per_category=${WARM_PER_CATEGORY:-12}
pause=${WARM_PAUSE_SECONDS:-0.3}

# The page list from the public API. python3 is on the host; jq is not.
# -I: no user site, no current directory on the import path.
pages=$(BASE="$base" PER_CATEGORY="$per_category" python3 -I - <<'PY'
import json, os, urllib.request

base = os.environ["BASE"]
per_category = int(os.environ["PER_CATEGORY"])

def api(path):
    req = urllib.request.Request(base + "/api" + path, headers={"User-Agent": "gost-warmup"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)

pages = ["/", "/catalog", "/sales", "/brand", "/delivery", "/organizaciyam", "/about", "/contacts"]
def safe(fn):
    try:
        return fn()
    except Exception:
        return []

header = safe(lambda: api("/storefront/header-categories")["data"])
tree = safe(lambda: api("/categories/tree?depth=1"))
roots = tree.get("data", tree) if isinstance(tree, dict) else tree
categories = [c["slug"] for c in header] + [c["slug"] for c in roots]
popular = safe(lambda: api("/storefront/popular-products")["data"])

seen = set()
def add(path):
    if path not in seen:
        seen.add(path)
        pages.append(path)

for slug in categories:
    add(f"/catalog/{slug}")
for product in popular:
    add(f"/product/{product['slug']}")
# Round-robin over the root categories, so the page cap cuts the tail of
# every category rather than the last categories entirely.
listings = [
    safe(lambda: api(f"/products?categorySlug={slug}&limit={per_category}&page=1")["data"])
    for slug in [c["slug"] for c in roots]
]
for rank in range(per_category):
    for listing in listings:
        if rank < len(listing):
            add(f"/product/{listing[rank]['slug']}")
print("\n".join(dict.fromkeys(pages)))
PY
) || { echo "Warm-up: could not build the page list" >&2; exit 0; }

started=$(date +%s)
warmed=0 slow=0 failed=0
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  (( warmed + failed < max_pages )) || break
  if t=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 30 -A 'gost-warmup' "$base$path"); then
    code=${t%% *}; secs=${t##* }
    if [[ "$code" == 200 ]]; then
      warmed=$((warmed + 1))
      awk -v s="$secs" 'BEGIN { exit !(s > 3) }' && slow=$((slow + 1))
    else
      failed=$((failed + 1))
    fi
  else
    failed=$((failed + 1))
  fi
  sleep "$pause"
done <<<"$pages"
echo "Warm-up: $warmed of $(grep -c . <<<"$pages") pages in $(( $(date +%s) - started )) s ($slow slower than 3 s, $failed not 200)"
