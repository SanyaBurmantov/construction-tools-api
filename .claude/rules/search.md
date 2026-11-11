---
paths:
  - "backend/src/products/search*"
  - "backend/src/search-log/**"
  - "frontend/app/composables/useSearchLog.ts"
  - "frontend/app/pages/search.vue"
  - "frontend/app/pages/admin/search.vue"
---

# Search

Russian full-text search beside trigrams, synonyms, the search journal.

- **Search understands Russian word forms** (`products/search-fts.ts`, 04.11).
  `rankedMatchIds` has a full-text `UNION` branch beside the trigram ones:
  every word of the term must match in some form (`russian` Snowball
  config, prefix per word, AND), so «компрессоры» (0 → 678), «пилы
  циркулярные» (0 → 73), «ключи гаечные» (1 → 455) find products. The
  document is an **expression** (name + sku + model, first two words of
  the name weighted A — the product's kind ranks first), indexed by
  `Product_search_fts_idx`; the planner uses it only while
  `FTS_DOCUMENT_SQL` is byte-identical to the migration (tested) — change
  it only together with a new index. `SEARCH_SYNONYMS` holds trade words
  and fleeting-vowel stems (болгарка/УШМ, диск/круг, уровень/уровни); add
  a group when /admin/search shows people missing one. Only letters and
  digits reach `to_tsquery`, so a term is never a syntax error.

- **Search journal** (`search-log/`, `SearchEvent`, `/admin/search` «Поиск»).
  The browser reports each search it showed (`POST /search/events`,
  `useSearchLog()`: the catalogue's first page with its result count) and each
  product picked from results (catalogue card/row link or header dropdown,
  with its position). Sent from the client on purpose — script-less crawlers
  stay out, and a page served from Nitro's cache still counts. Terms are
  normalised (lower case, ё→е, spaces, ≤120); no account, the IP only as the
  reviews' salted hash, used to count the same search from the same visitor
  within 10 min once. The report: totals, «ничего не найдено» (what the
  catalogue is missing), frequent searches with click rate, latest events.
  `SEARCH_LOG_TTL_DAYS` (365), purged nightly by the worker. It is the input
  for the next search work (vectors only if the zero-result list turns out to
  be «смысловые» queries).
