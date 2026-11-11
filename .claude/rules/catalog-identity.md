---
paths:
  - "backend/src/parser/**"
  - "backend/src/offers/**"
  - "backend/src/categories/**"
  - "backend/src/brands/**"
  - "backend/src/products/**"
  - "backend/prisma/schema.prisma"
---

# Catalogue data: identity, offers, merges

Product identity is the supplier offer, category identity is pathKey, one product — many offers, who owns a card, merges and splits.

- **Data model**: products are stored in two layers — `Product` (normalized
  storefront card) and `SourceProduct` (raw supplier snapshot, identity
  `@@unique([sourceId, url])`). See `parsing.md`.

- **Product identity is the supplier offer, not `Product.slug`.** Parsers must
  save through `ProductIdentityService.save()` (`parser/product-identity.service.ts`),
  which resolves the product via `SourceProduct(sourceId, url)` and only mints a
  slug for genuinely new products (`-2`, `-3`… when the pretty one is taken).
  The old `product.upsert({ where: { slug } })` had two failure modes seen in
  production: two items whose names slugify the same **silently overwrote each
  other** (queue said DONE, catalogue gained nothing), and — because a nested
  `images: { create }` stops Prisma using `INSERT … ON CONFLICT` — two workers in
  one batch raced and the loser threw `Unique constraint failed … (slug)`. The
  same service wraps the `Brand` and `Specification` upserts, which raced for the
  same reason. Anything creating products from a parse goes through it.
  `upsertBrand()` also refuses values that are not brands (`parser/brand-name.ts`:
  «запчасти…», «без товарного знака», «Измерители», «-»…) — the product gets
  no brand — including measurements and bare numbers («420 литров/мин»: dukon's
  compressors became brands because `findSpecValue(…, 'производитель')`
  matched «Производительность»; dukon now matches the spec *name*,
  `findBrandSpec`). `BrandCleanupService` removes such rows imported earlier
  (on boot, nightly at 04:17 and `POST /admin/parser/clean-brands`); brand identity is the slug, so case
  variants are already one row. A brand an admin **merged** away leaves a
  `BrandAlias(slug → survivor)` that `upsertBrand()` resolves first, or the
  next parse recreated it and pulled its products back.
  **Admin corrections survive the re-parse**: every parser-owned field an admin
  edits (`name`, `categoryId`, `brandId`, descriptions, SEO, sku/model/barcode)
  joins `Product.lockedFields`, which `save()` skips exactly like
  `aiLockedFields` — only a field whose value actually **changed**: the
  product form sends every field on every save, and «sent» used to lock the
  whole card against the supplier the first time someone fixed a price. "Удалить" in the admin **archives** the product
  (`ARCHIVED`, `statusSource: ADMIN`): a hard delete cascaded away customer
  reviews and price history, and the next parse recreated the product anyway.
  A new product and a stub of its `SourceProduct` are created in one
  transaction, so a parse that fails later cannot leave an orphan that the
  retry duplicates as `slug-2`.

- **A product with offers from several suppliers has one owner.**
  `ProductIdentityService.forExistingProduct()`: the oldest offer
  (`SourceProduct.createdAt`, then `id`) rewrites the card; the others only
  fill empty fields, and move the category only out of the hidden fallback —
  otherwise each parser wrote its own name, texts, photos, brand and category
  every day and the card flipped between suppliers. Stock/price are per offer
  as before. Specs are saved under the product's **actual** category
  (`saveSpecifications` reads it), not the supplier's breadcrumb one — a
  locked or owner-kept category used to lose its facets. And when a supplier
  changes what identifies a product (article, short model suffix, SOLO/SET,
  sizes, pack) while our name is locked, the product gets
  `supplierNameChange` and shows in the data-quality panel («Поставщик
  переименовал») until an admin saves it (`parser/name-drift.ts`).

- **Category identity is `Category.pathKey`, not `slug`.** `pathKey` is the full
  slug chain (`aksessuary/avtolampy/narva`); `slug` is only the public URL.
  Parsers must build the tree through `CategoryTreeService.upsertBranch()`
  (`parser/categories/`), never with `category.upsert({ where: { slug } })` —
  that keyed on the leaf name, so every branch ending in "Прочее" collapsed into
  one category and the first branch to parse won the parent. The slug still
  prefers the bare leaf (existing URLs don't move) and only falls back to
  `parent-leaf` → full chain → numbered when another branch already holds it.
  Anything that re-parents, re-slugs or merges a category must go through
  `categories/category-path-alias.ts` (`rekeyCategory`, `moveCategoryAliases`):
  the new `pathKey` is written and the **old one is kept in
  `CategoryPathAlias`**, which `upsertBranch()` checks first — the supplier
  still spells the old breadcrumb chain, and without the alias the next parse
  recreated the branch at its old position and pulled its products back (the
  root cause of the «Двигатель» duplicates). An alias hit is never "repaired"
  back to the supplier's parent.
  **Same-named siblings are one category.** The nightly root merge re-keys moved
  children, so the parser kept re-creating the supplier branch and the next
  merge parked it beside the canonical one — prod grew six «Двигатель» under one
  parent (`…-dvigatel-2` … `-6`). Two guards now: `upsertBranch()` reuses an
  existing same-named child of the parent (at the root, after resolving the
  `taxonomy.ts` synonym) before creating anything, and `merge()` is **deep** —
  a child the target already has by name is merged into it, not re-parented.
  What was already duplicated is listed at `GET /admin/categories/duplicates`
  and folded per group (`POST …/duplicates/merge`, «Дубли» view in
  `/admin/categories`) — and, since the owner asked for it, **every night**
  by `CategoryDuplicatesCron` (04:47, ≤100 groups, same deep merge with
  aliases and 301s; a group whose copies differ in visibility is left for an
  admin). Not every `-N` slug is a duplicate: «DIN 7981» is a standard's
  number. **A merge keeps the clean address**: the duplicates' survivor is
  the biggest subtree, often the parser-filled `…-2` copy, so `mergeInto`
  gives a survivor that is a numbered copy of the merged category
  (`isNumberedCopyOf`) the clean slug and leaves the `-2` as a redirect —
  eight roots (Электроинструмент, Сантехника…) had ended up on `-2` with the
  clean slug redirecting to them (fixed by hand 2026-11-05).
  The parsers' fallback «Неразобранные товары поставщиков»
  (`FALLBACK_CATEGORY_SLUG`) is created `isVisible: false`, so it is in no
  storefront listing; its URL and its products' URLs still work.

- **One product, many supplier offers** (`offers/`). `Product` is the canonical
  card; `SourceProduct` rows hanging off it are competing supplier offers.
  Matching (`product-matching.ts`, pure and unit-tested) ranks signals
  barcode > brand+sku > brand+model > similar name. An article number only
  identifies together with its brand, and a name match across *different*
  brands is always rejected. **Only barcode and brand+sku auto-merge** — weaker
  signals go to `/admin/duplicates` for a human, because an incorrect merge is
  expensive to unpick.
  `ProductMergeService.merge()` moves offers, images, specs, reviews, price
  history and order lines onto the survivor inside one transaction. Moving
  `Review` and `PriceHistory` is **mandatory, not tidiness**: both cascade on
  delete, so skipping them would silently destroy customer reviews. The merged
  slug becomes a `ProductRedirect`, and the product page turns that into a 301.
  Customers' stored carts, wishlists and comparisons (also cascading) are
  moved too, a duplicate's MANUAL price, field locks and pending review are
  carried over (`mergedState()`), and auto-merge never folds away or into a
  product an admin hid or archived — the survivor is the one on sale with the
  most live offers.
  **One supplier, two articles = two products.** The old slug-keyed parser
  attached every th-tool.by listing with the same title (Forsage F-…,
  RockForce RF-…) to one card — 7 471 cards, 23 813 offers on 2026-11-02.
  `OfferSplitCron` (worker, `offers/offer-split*.ts`) gives each other
  (supplier, article) its own DRAFT product, queues the URLs first and lets
  the parse fill and publish them; it keeps running, so a card that collapses
  again is taken apart within ten minutes. The same rule keeps auto-merge and
  `/admin/duplicates` off such groups (th-tool.by also reuses one EAN per
  series). Articles of *different* suppliers prove nothing — each `sku` is
  that supplier's own number.
  **`Product.costPrice` comes from the cheapest offer**, not from whichever
  parser ran last — in-stock offers outrank a cheaper unavailable one. Parsers
  call `offers.onProductParsed(productId)` *after* saving their SourceProduct.
  Public API exposes only `offers: { count, inStockCount }`. Supplier URLs and
  our costs must never reach the storefront — they are admin-only
  (`GET /admin/offers/product/:id`).

- **A product no supplier carries keeps its page** (2026-11-06,
  `products/product-page-visibility.ts`): HIDDEN by the system (not an
  admin) and seen at a supplier within 180 days → `GET /products/:slug`
  answers it with `unavailable: true` and no price; the page shows «Нет в
  наличии», a request to the manager and the similar items. Still out of
  listings, search and the sitemap; admin-hidden/archived/draft still 404.
