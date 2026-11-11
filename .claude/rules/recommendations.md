---
paths:
  - "backend/src/products/relations/**"
  - "feature.md"
  - "frontend/app/components/product/**"
---

# Product page recommendations

«Похожие», compatibility, fit by standard, size variants, packs, upsell tagging.

- **Product page recommendations** (`products/relations/`,
  `GET /products/:slug/recommendations`, details in `feature.md`). «Похожие»
  are computed per request: **the same kind of item only** (`productKind`),
  the product's category first, then the same kind filed elsewhere, ranked by
  title, specs, sizes in the name, price and brand; in stock first within a
  tier. **Relevance over a full row** (owner, 2026-11-04): another kind never
  fills the gaps — the old «never empty» filler made 44% of the row another
  kind (window handles beside key tags); a short row or none is right, the
  storefront hides an empty block. The ranking is **computed ahead**
  (`ProductSimilar`, `relations/similar-refresh.service.ts`, worker, 40
  products / 30 s): only the ranked ids are stored — cards, prices and stock
  are read live, so a stored row cannot show an old price; a row is redone
  after 3 days, when the product's text changes, or when
  `SIMILAR_RULE_VERSION` is bumped (do that whenever the similarity rules
  change). A page with no usable row computes and stores it itself. It was
  the costliest query of a product page (~1100 s of DB a day, crawlers).
  «Аксессуары» / «Подходит для» read one table, `ProductCompatibility`
  (accessory → tool), built by `CompatibilityRefreshService` in the worker —
  200 products / 30 s, a full pass ≈ 3.6 h, no button. Only an explicit
  supplier claim («Мешок для пылесоса BULL AS 3001», «подходит для …») with a
  brand and a model code counts. **The tool's model is read from its name**:
  in production `model` is empty and `sku` is the supplier's internal number —
  matching on those columns alone found 1 link in 85k products. A model's kits
  match (`DF333` → `DF333DWYE`, never `VX100` → `VX1000`) and every listing of
  the same model is linked (markdown copies are not ambiguity). An AI-renamed
  accessory is read from its owning `SourceProduct` (name and description) —
  DeepSeek rewriting the catalogue must not erase supplier claims. Rows carry
  md5 signatures of their inputs that the read checks, so an edit hides a
  link at once, and each tick first re-reads products whose
  `contentUpdatedAt` moved (keyset on time+id — a bulk update stamps one
  millisecond) plus their linked accessories, so it comes back within a tick;
  bump `COMPATIBILITY_RULE_VERSION` when the rules change.
  **Fit by standard** (`relations/fitment.ts`, `ProductFitment`): a TOOL takes
  a key, a PART provides it — battery platform (Makita LXT/CXT/XGT — the G
  series is *not* LXT —, WORTEX ALL1, BULL XLTpro, Milwaukee), grinder disc
  diameter on a 22.2 arbor, SDS-plus/max, saw-blade diameter, 1/4" hex. It
  crosses brands and suppliers on purpose; built by the same worker. The cart
  shows «Не забудьте к заказу» (`GET /recommendations/cart`, not under
  `/products` — `:slug` would take it), and the buy box compares packs per
  piece (`relations/packs.ts`). Every block tags the cart line it adds;
  `OrderItem.upsellSource` feeds the dashboard's «Допродажи» (bump
  `FITMENT_RULE_VERSION` when tag rules change). Fasteners and hand tools
  too: socket drive, metric thread (bolt ↔ nut/washer, same material
  first), anchor hole ↔ masonry bit, screw recess ↔ bit.
  **Size variants** (`relations/variants.ts`, `ProductFamily`): brand + the
  name with sizes masked is one line — the card's own `sku` is taken out of
  the name first (`withoutArticle`: «GARWIN 122405-M10*1,25 Метчик …»,
  «… Thorvik FS21213» carry a per-size article); the buy box switches between its
  sizes (each stays its own page). Standards, models, long codes and power
  tools are deliberately not sizes — see the module before loosening it.
  The family is read from the supplier's name when AI rewrote ours
  (`ProductFamily.keyName`); `Product.variantLine/variantLabel` are an
  optional override (nobody has to fill them — the site is automatic).
