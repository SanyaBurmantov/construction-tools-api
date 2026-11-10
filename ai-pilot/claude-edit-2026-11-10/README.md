# Claude-rewritten descriptions: does indexing change?

200 products whose descriptions Claude rewrote on 2026-11-09/10 (`treated`:
100 random across the catalogue via `/claude-edit-products`, 100 fasteners)
and 186 untouched products from the same categories (`control`). URLs did not
change, only the texts (+ IndexNow, sitemap lastmod).

Baseline, Google URL Inspection, 2026-11-10:

| | indexed | discovered, not indexed | unknown to Google |
|---|---|---|---|
| treated (200) | 65 (32.5%) | 19 | 115 |
| control (186) | 45 (24.2%) | 17 | 123 |

The groups already differ at the start — compare the **change** of each group,
not the shares. Re-measure in 1–2 weeks:

```sh
GSC_MEMORY=<memory>/gsc-service-account.md NODE_USE_ENV_PROXY=1 \
  node ai-pilot/claude-edit-2026-11-10/inspect-google.mjs \
  ai-pilot/claude-edit-2026-11-10/groups.json ai-pilot/claude-edit-2026-11-10/google-<date>.json
```

Yandex is not in the baseline yet (its Webmaster token was not available to
the session).
