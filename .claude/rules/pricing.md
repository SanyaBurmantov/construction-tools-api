---
paths:
  - "backend/src/pricing/**"
  - "frontend/app/pages/admin/pricing.vue"
---

# Pricing

PricingService owns the storefront price: rules, rounding, MANUAL mode, price history.

- **Pricing / margin engine** (`pricing/`). Supplier cost lives in
  `Product.costPrice`; the storefront price is derived from it by `PricingRule`
  (percent and/or flat markup, minimum absolute margin, cost bands, rounding
  `.90/.99/integer/tens`, priority). The most specific active rule wins —
  SOURCE > BRAND > CATEGORY > GLOBAL — and a CATEGORY rule covers the whole
  subtree. Pure arithmetic sits in `pricing.calculator.ts` with no DB access,
  so it is directly testable.
  **Invariant: `PricingService` is the sole owner of `Product.priceValue` and
  `oldPrice`.** `ProductIdentityService.save()` strips prices, `status` and the
  lock columns from whatever a parser passes, and creates a new product as
  `DRAFT` with no price — it is published by `publishIfReady()` once
  `applyCost` has priced it (it used to go live at the raw supplier cost). An
  admin typing a price makes the product `MANUAL` and writes `PriceHistory`.
  Rounding snaps to kopecks before rounding up (100 × 1.1 is
  110.00000000000001, which `Math.ceil` turned into 111); a CATEGORY rule
  covers the subtree by walking `parentId` (not `path`, which holds the
  parser's slugs); "recalculate all" re-reads the supplier's "was" price from
  the best offer instead of wiping every discount.
  Writing the price in the parser would clobber MANUAL prices.
  **There is no spike guard** (owner, 2026-11-23: «защита от скачков не
  надо, берем сразу от поставщика»). A cost change beyond 50 % used to be
  held for review in `/admin/pricing` with the old price left live — which
  sold a used DGM pump at 214.78 against a 343.66 supplier price. Every new
  cost now goes straight to the price; `priceReviewNeeded` and the
  `blocked_spike` history rows are legacy (the review endpoints still read
  them, nothing writes them). Don't bring a guard back without the owner.
  `pricingMode = MANUAL` pins the price: parsing records the
  cost (so margin stays honest) but never touches the price. A supplier's own
  "was" price is marked up by the same rule, and cleared when the supplier's
  discount ends. Every change is written to `PriceHistory`.
  Adoption on an existing catalogue: `POST /admin/pricing/backfill-cost` adopts
  current storefront prices as costs, then run the recalculation.
