---
paths:
  - "backend/src/products/**"
  - "backend/src/categories/**"
  - "backend/src/storefront/**"
  - "backend/src/brands/**"
  - "backend/src/seo/**"
  - "frontend/app/components/catalog/**"
  - "frontend/app/components/home/**"
  - "frontend/app/components/storefront/**"
  - "frontend/app/components/ui/UiCategoryCard.vue"
  - "frontend/app/composables/useCategory*.ts"
  - "frontend/app/pages/index.vue"
  - "frontend/app/pages/catalog/**"
  - "frontend/app/pages/brand/**"
  - "frontend/app/pages/product/**"
  - "frontend/app/pages/admin/categories.vue"
  - "frontend/app/pages/admin/storefront.vue"
---

# Catalogue on the storefront

Category tree and browsing API, facets, curated blocks, the home page, category cards, default order, SEO bits.

- **Catalog browsing**: categories are a tree (parsers build it from supplier
  breadcrumbs; products attach to leaves). Public API: `GET /categories/tree`
  (aggregated counts, empty branches pruned), `GET /categories/:slug`
  (ancestors + children for a category page), `GET /brands/:slug/categories`.
  `GET /products` filters by `categorySlug`/`categoryId` **including the whole
  subtree**, supports comma-separated `brandId`, `inStock`, `onSale`, and returns
  filter-aware facets (each dimension excluded from its own counts) plus
  `facets.priceRange`. `sortBy` accepts `name|price|rating|createdAt|updatedAt`
  — note that Prisma only allows the `nulls: 'last'` option on **nullable**
  columns, so it is applied to `priceValue`/`ratingAvg` only. Frontend:
  `/catalog` + `/catalog/<category-slug>` pages share
  `components/catalog/CatalogView.vue`; filters live in query params
  (`brands`, `source`, `priceMin/Max`, `inStock`, `onSale`, `sort`, `page`).

- **A listed category always has something in it.** Nothing in the storefront
  may render a category whose count is 0 — it is a link to the "ничего не
  найдено" screen, not a choice. Two layers enforce it: `pruneUnlistable()`
  drops empty *and* admin-hidden branches from the tree and from a category
  page's children, and `GET /products` leaves a category out of
  `facets.categories` entirely instead of reporting `0`, so the subcategory
  strip beside the grid stays filter-aware (switch on `onSale` at the top level
  and only categories that actually have a discounted product remain).

- **Categories are curatable, identity is not.** `Category.isVisible` /
  `isFeatured` are admin presentation settings, editable per row
  in `/admin/categories`. **Order is the product count, biggest first,
  everywhere** — tree, menu, category page, the catalogue's subcategory
  strip (by the count under the current filters) and the admin tree (owner,
  2026-11-05). `sortOrder` stays in the table but orders nothing: the old
  ↑/↓ buttons renumbered all 42 roots almost alphabetically and put
  «Косметика, уход» first; the buttons and the field are gone
  (`PATCH /admin/categories/order` remains for scripts, the normalizer still
  treats `sortOrder > 0` as «curated» when pruning empties). `isVisible: false` hides a branch from the menu, the tree, the
  facets and search suggestions while leaving its URL working;
  `isFeatured` pins it into the home page grid's automatic part (after the
  header strip's picks). None of this touches `pathKey`,
  so the parsers keep upserting the same rows. Admin edits that *do* move a
  category (`parentId`, `slug`) rebuild `path`/`level`/`pathKey` for the whole
  subtree (old keys kept as aliases, see `catalog-identity.md`) and leave the old slug behind
  as a `CategoryRedirect`.
  **Phones (≤ 560px)**: category tiles three to a row, product cards two to
  a row (`.product-grid`, `storefront.scss`) with the spec preview hidden and
  «В корзину» as a cart icon beside the price; a card's name is clamped to
  three lines everywhere.
  Frontend: one `components/ui/UiCategoryCard.vue` renders every "link to a
  category" — `tile` (shop window: photo on a soft plate in one scale,
  count as a label, lift on hover; home + `/catalog`), `compact` (64px
  photo + name + count; a category page's subcategories, first 8 then
  «Показать все», the rest rendered hidden for crawlers), `row` (brand
  page), `chip` (the strip once a filter is on). Tile artwork is the
  category's **typical** product — first with a real photo in the default
  order (`listingRank`, name), placeholders skipped — and a parent borrows
  its biggest part's picture (owner, 2026-11-05; the dearest product was the
  odd one out — a stand, a watermarked station). The map is cached 15 min
  and refreshed in the background. — and
  `composables/useCategoryTree.ts` is the single tree fetch (one shared
  `useAsyncData` key for header, home and catalogue). That SSR fetch is
  **roots only** (`GET /categories/tree?depth=1`, trimmed to the fields drawn):
  it is embedded in every page's `__NUXT_DATA__`, and the full ~3k-node tree
  made /delivery 1.15 MB of HTML. The roots' children, drawn only in the closed
  catalogue menu / mobile drawer, come client-side from `useCategoryMenu()`
  (`depth=2`, on idle or intent). Counts are aggregated before the cut;
  without `depth` the endpoint still returns the full tree (the sitemap uses it).

- **Hand-picked storefront blocks** (`storefront/`, `/admin/storefront`
  «Витрина»). Two lists in `SiteSetting` (`storefront.headerCategories`,
  `storefront.popularProducts`, JSON): the strip under the header on every
  page — categories of **any level**, own order, optional shorter label and
  «выделить» (accent colour, `.nav-link.is-accent`); it also sets the order
  of the home page's «Каталог» tiles (9, the automatic grid fills the rest;
  artwork and count come in the same answer, read under the home page's own
  key `useHomeCategoryTiles()` so they stay out of every other page's
  payload), whose first four are «Популярное:» under the home search — and
  the home page's «Выбирают покупатели» row. Public `GET /storefront/header-categories` and
  `/storefront/popular-products` answer only what may be shown right now
  (`CategoriesService.listableByIds()`: visible, non-empty, no hidden
  ancestor; `ProductService.cardsByIds()`: published with a price), so a pick
  can never put a dead link on every page. **Empty = automatic**: the strip
  falls back to the first 7 roots, the row to the best-rated products —
  exactly what the site did before. The header strip is one small SSR fetch
  (`useHeaderCategories()`, shared key with the home page), cached 30 s in
  the API.

- **Home page** (05.11, `pages/index.vue`): hero → terms → «Каталог»
  (12 tiles: 6 × 2 on a computer, 4 × 3 on a tablet, 3 × 4 on a phone) → «Популярное у организаций» →
  `HomeForCompanies` (three steps of a purchase by invoice, cart / price
  list / supply contract, the seller's requisites) → «Новинки» → brands.
  Since every supplier category is imported, the automatic rows skip the
  **non-core departments** (`products/core-catalog.ts`
  `NON_CORE_ROOT_NAMES`: cosmetics, household, home, garden, bikes, car
  cosmetics, the fallback) — `GET /products?core=1`; «Новинки» are core,
  in stock, at most two per category out of 40. «Популярное» is the curated
  list when there is one, else `StorefrontService.autoPopularIds()`
  (`storefront/auto-popular.ts`, hourly, stale-while-revalidate): orders ×5,
  cart lines ×3, search clicks ×2, our visitors ×1 — Metrika cannot do it
  (people-only hides URL rows, with robots it is crawler noise) — then a
  daily-rotating fill from the biggest core departments, ≤2 per department.
  Brands are the 16 biggest by product count; «Популярное:» under the search
  is `GET /search/popular` (terms ≥2 visitors in 30 days) once there are
  three, else the first tiles.

**The catalogue size is never typed in** (12.11): the pages said «95 000+»
and «более 50 тысяч» at once. Home hero, /organizaciyam (text + meta),
/about, the 404 and `/llms.txt` print `catalogSizeText()`
(`composables/useCatalogSize.ts`, pure part `utils/catalog-size.ts`, tested):
the sum of the root counts from `/categories/tree`, rounded down to thousands
(«95 000+ позиций»); unknown → the sentence goes without a number.

**Default catalogue order: complete cards first.** `Product.listingRank`
(real photo 2 + description 1) is recomputed hourly by `ListingRankService`;
the default sort and search ties order by it before the name, so the cards
without a photo or text sink to the end. An explicit sort ignores it.
Supplier tab labels in front of a description («Файлы BULL Электроинструмент
Описание: …», «Описание:») are stripped by `stripTabHeaders` in
`supplier-text.ts`.

**SEO bits worth not undoing.** `robots.txt` closes the client-rendered
private screens (their `noindex` exists only after JS) and has Yandex
`Clean-param` for tracking tags and `sort`. og:image is our own
`/_ipx/…&s_1200x630&fit_contain&b_ffffff` (`utils/og-image.ts`), never the
supplier URL, and always **absolute** — the default `/og-image.png` is set in
`app.vue` from `siteUrl` (in `nuxt.config` `app.head` it was relative: the
home page, /brand, /sales). Product JSON-LD carries `gtin*` from the barcode,
`priceValidUntil` = last offer sync (`priceCheckedAt`) + 7 days **only while
that date is after today** — otherwise the field is left out, never
re-dated (`utils/product-jsonld.ts`; a past date makes Google drop the
offer, 12.11: tens of thousands of cards of unparsed suppliers), shipping and
return policy; `description` is cut to ~1000 characters at a sentence.
Product pages are `og:type=product` with `product:price:*`. A category's `seoDescription` equal to its name counts as
empty and the template is used until an AI task writes one.
