---
paths:
  - "backend/src/orders/**"
  - "backend/src/cart/**"
  - "backend/src/lists/**"
  - "backend/src/promo/**"
  - "backend/src/account/**"
  - "backend/src/b2b/**"
  - "backend/src/requisites/**"
  - "backend/src/attribution/**"
  - "frontend/app/stores/**"
  - "frontend/app/pages/cart.vue"
  - "frontend/app/pages/checkout/**"
  - "frontend/app/pages/account.vue"
  - "frontend/app/pages/organizaciyam.vue"
  - "frontend/app/pages/favorites.vue"
  - "frontend/app/pages/compare.vue"
  - "frontend/app/components/cart/**"
  - "frontend/app/components/account/**"
  - "frontend/app/composables/useServerCart.ts"
  - "frontend/app/composables/useCheckoutAuth.ts"
  - "frontend/app/composables/useOrderTerms.ts"
  - "frontend/app/utils/attribution.ts"
---

# Orders, cart, accounts and B2B

Checkout and terms of sale, organisations-only mode, cart re-pricing and server backup, guest lists, promo codes, the account pages, company requisites, invoices/quotes/leads, traffic attribution.

## Orders and checkout

- **Storefront orders**: the storefront now asks for an account before
  checkout, while `POST /orders` itself still accepts a guest order (see
  "Checkout requires an account" below) — so the API contract and the runbook
  did not change. The cart lives client-side
  (Pinia `stores/cart.ts`, persisted to `localStorage`); `POST /orders`
  (`orders/` module) re-prices every line from the DB (never trusts the client),
  validates published/priced products, computes delivery cost, applies any promo
  code **server-side**, and snapshots product name/slug/image/price into
  `OrderItem`. Admin manages orders via `GET /admin/orders`,
  `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status`.
  **Organisations and ИП only** (owner, 2026-11-06 — «временно», until the
  owner says otherwise): `POST /auth/register` refuses anything but a COMPANY
  with a УНП, a customer cannot switch a company account to INDIVIDUAL, and
  `POST /orders` takes `INVOICE` only (CASH/CARD → 400). Every УНП is checked
  against the tax ministry's public payer registry
  (`requisites/`, `grp.nalog.gov.by/api/grp-public/data`, covers ИП too;
  `GET /requisites/unp/:unp` fills the name and address in the forms via
  `useUnpLookup`): unknown or liquidated → 400, registry down → let through.
  The «В корзину» buttons stay for everyone, with `StorefrontRetailNote`
  under them (retail = the shop or the phone). `/usloviya` and `/garantiya`
  are written for business buyers (ГК, not the consumer law) and wait for the
  lawyer (task in `/admin/plans`). Reverting is one commit.
  **Terms of sale** (owner, 2026-11-02; `orders/order-terms.ts`, pure and
  tested): an individual orders from 200 BYN, an organisation — an order with
  a payer, i.e. by invoice or from a company account — from 50 BYN; courier
  20 BYN, post 10 BYN, pickup free, and courier/post are free for an
  organisation from 300 BYN of goods (after the promo discount). `POST /orders`
  answers 400 `ORDER_MINIMUM` below the minimum. All env-tunable
  (`ORDER_MIN_INDIVIDUAL`, `ORDER_MIN_COMPANY`, `FREE_DELIVERY_COMPANY_FROM`,
  `DELIVERY_COST_COURIER`, `DELIVERY_COST_POST`), mirrored to the storefront as
  `NUXT_PUBLIC_*` and read there through `useOrderTerms()` (cart, checkout,
  the invoice form, /delivery, /usloviya, /organizaciyam, product and home).

- **Checkout requires an account, browsing does not.** `POST /orders` runs
  under `OptionalAuthGuard`: with a session it stamps `Order.userId` (that
  link is the **only** thing that puts an order in «История заказов» — orders
  are deliberately never matched to an account by phone or e-mail afterwards,
  or anyone could register with someone else's phone and read their orders),
  without one it is still a guest order, which is what keeps the runbook and
  the existing API contract working. The gate is on the storefront:
  `useCheckoutAuth().ensureAuthenticated()` sends a guest from the cart to
  `/login?redirect=/checkout&reason=checkout`, and the login/register screens
  render the reason from `AUTH_REASONS` and return to `redirect` afterwards.
  The cart survives the detour because it lives in localStorage — nothing is
  re-fetched or merged. Checkout prefills name/phone/e-mail from the profile,
  but only into blank fields, so a different recipient typed for one order is
  never overwritten.

- **Discounts**: `Product.oldPrice` above `priceValue` marks a product as
  discounted — that's what `onSale` and the `/sales` page filter on.
  `PromoCode` (`promo/` module) is validated at `POST /promo-codes/validate` for
  the checkout preview and **re-evaluated** inside `POST /orders`, so an
  exhausted or expired code is still rejected at order time. The use is
  claimed with a conditional `UPDATE … WHERE "usedCount" < "maxUses"` inside
  the order transaction (the check alone let N parallel checkouts spend a
  single-use code N times), `POST /orders` has its own `@Throttle` (10/min),
  and cancelling an order gives the use back. Order status moves forward only
  (cancellation allowed until it ends; DELIVERED/CANCELLED are final) —
  enforced by `canMoveOrder()`, not just the admin UI. Admin CRUD lives
  under `/admin/promo-codes`. `listAvailable()` is what the account's
  «Доступные промокоды» section lists: active, in-window, not exhausted and
  `isPublic` — turn that flag off for a code meant for one person and it keeps
  working while no longer being advertised to everyone who signs in. The
  exhausted check is done in JS because Prisma cannot compare two columns
  (`usedCount >= maxUses`) in a `where`, and `usedCount`/`maxUses` never leave
  the admin API.

## Cart and lists

- **Cart is client-side, prices are not.** The cart lives in `localStorage` and
  stores the price captured when an item was added, but supplier prices are
  re-parsed daily — so a restored cart drifts. `POST /cart/validate` (`cart/`
  module) re-prices a cart against the DB and flags each line
  (`price_changed` / `unavailable` / `price_missing` / `out_of_stock`); the cart
  and checkout screens call it on mount and render `components/cart/cartIssues.vue`.
  As a backstop, `POST /orders` accepts `expectedItemsTotal` and answers **409**
  when it no longer matches, so an order can never quietly cost more than the
  cart the customer saw. The frontend keys off the 409 status — the shared
  exception filter strips extra fields from the error body.

- **The account's cart is backed up server-side** (`CartItem`,
  `cart/server-cart.service.ts`), while the **localStorage cart stays the one
  the UI renders and checkout submits** — a guest has only that, and a failed
  sync must cost nothing. Three rules keep the two from fighting:
  only `productId` + `quantity` are stored (**never a price** — a line is
  re-priced from `Product` on every read, so a stored row cannot resurrect an
  old price); on **sign-in** the local cart is *merged* up and the merged cart
  replaces the local lines (`POST /cart/merge`), which is what makes "pick
  things as a guest, then log in" keep everything and what restores a cart on
  a new device; on every **later change** the local cart is pushed up whole
  (`PUT /cart`, debounced 800 ms — last write wins, because a cart is edited
  on one device at a time). The merge keeps the **larger quantity, never the
  sum**: summing looks right until the same cart syncs twice (two tabs, a
  re-login, an offline edit) and every line silently doubles. Unpublished or
  deleted products are dropped from the stored cart as it is served (and the
  row deleted), `POST /orders` empties it once an order from that account is
  committed, and `CartCleanupCron` drops carts untouched for `CART_TTL_DAYS`
  (90). Frontend: `plugins/cart-sync.client.ts` + `composables/useServerCart.ts`;
  `stores/cart.ts` gains only `applyServerCart()`.
  `POST /cart/validate` stays **public** — a guest cart needs re-pricing too —
  while `GET/PUT/DELETE /cart` and `POST /cart/merge` are `AuthGuard`-only and
  always scoped to the session's `userId`.

- **Guest lists**: cart, wishlist (`stores/wishlist.ts`) and comparison
  (`stores/compare.ts`, max 4 items) are all localStorage-backed and loaded on
  `onNuxtReady` by the two sync plugins (`plugins/cart-sync.client.ts`,
  `plugins/lists-sync.client.ts`, both built on `utils/server-mirror.ts`). Pages `/favorites` and `/compare` are `ssr: false`.
  For a signed-in account both lists are backed up server-side exactly like the
  cart (`UserListItem` + `lists/`, one table with a `kind` because the two
  features differ only in the cap): merge on sign-in, replace on change,
  `plugins/lists-sync.client.ts`. Merging a **full** comparison keeps the four
  already stored rather than the newly arrived ones — signing in must not
  reshuffle the table someone is looking at. `LIST_TTL_DAYS` (365) bounds it.

## Accounts and companies

- **Личный кабинет** (`/account`, four sections in one page, the open one kept
  in `?tab=`): *общая информация* (figures + profile + last order), *история
  заказов* (status filter, paging, expandable composition, «повторить заказ»),
  *промокоды*, *настройки* (profile, password, "выйти на всех устройствах").
  Settings also closes the account: `DELETE /auth/me` takes the password
  (a session could be a borrowed laptop), cascades sessions / stored cart /
  stored lists away and **keeps orders and reviews** with their link nulled —
  the shop's records and other customers' reading material are not the
  account's to erase. An ADMIN is refused there on purpose: removing an
  administrator belongs in `/admin/users`, which already protects the last one.
  Read side is `GET /account/summary|orders|orders/:id|promo-codes`
  (`account/` module, `AuthGuard`, every query scoped to the session's
  `userId` — the API never takes a user id from the client); writes stay on
  `/auth/me`. Someone else's order id is a **404, not a 403** — a 403 would
  confirm the order exists. «Повторить заказ» re-adds the order's lines from
  the *snapshot* and the cart's own `POST /cart/validate` re-prices them, so an
  old price can never come back silently.

- **Company buyers (юрлица).** A COMPANY account keeps its invoice
  requisites in `User` (`taxId` = УНП, `legalAddress`, `bankAccount` = BY
  IBAN, `bankName`, `bankBic`), validated by `common/utils/requisites.ts`
  (УНП mod-11 check digit, IBAN mod-97, BIC shape; the storefront has a copy in
  `utils/requisites.ts`) and stored normalized. **The payer is snapshotted into
  the order** (`Order.payer*`, `orders/order-payer.ts`): what checkout typed
  wins field by field, a company account fills the rest — reading it through
  `Order.user` lost it as soon as the profile changed or the account was
  deleted. `INVOICE` without an organisation and its УНП is a 400. Telegram,
  the shop letter and the customer's confirmation letter lead with the payer;
  admin order search matches the organisation and УНП. Checkout defaults a
  company to `INVOICE`, prefills the «Плательщик» block from the profile and
  saves typed requisites back into blank profile fields. One form component
  for all of it: `components/account/companyRequisites.vue`. Cart limits are
  sized for purchase requests — 9999 per line, 300 lines
  (`cart/cart-limits.ts`, mirrored in `stores/cart.ts`). Search matches a
  barcode (8–14 digits) as a whole code, including the `A (B)` pairs suppliers
  store; dukon.by publishes no barcodes at all.

- **B2B documents, leads, lists** (`b2b/`). **Invoice PDF**
  (`GET /orders/:id/invoice.pdf`, public by UUID like the confirmation) for an
  `INVOICE` order with a payer; **commercial offer PDF**
  (`POST /documents/quote`, re-priced from the DB, records a `QUOTE` lead);
  **XLSX price list** (`GET /price-list.xlsx?categorySlug|brandSlug`,
  streamed with exceljs in id-cursor chunks — never one workbook in the heap);
  **purchase lists** (`/account/purchase-lists`, ids + quantities only,
  hydrated from `Product` on read like the stored cart); **leads**
  (`POST /leads`: «уточнить наличие / подобрать аналог», the form on
  `/organizaciyam`; honeypot, @Throttle, ≤20/IP/day by salted hash; Telegram
  orders topic + shop mail; `/admin/leads`, `newLeads` badge). PDFs are
  pdfkit with Liberation Sans from `backend/assets/fonts` (the built-in fonts
  have no Cyrillic; the Dockerfile copies `assets/`). **No invoice without
  the seller's requisites**: bank account, bank, BIC and the VAT status live
  in `SiteSetting` (`seller.*`, `SellerService`, `/admin/settings`), no code
  default for any of them — a made-up account or a guessed VAT line is worse
  than none. Until they are set the order still goes through and the
  storefront says the manager will send the invoice; once set, the success
  page, the account history, the admin order and the customer's letter all
  link the PDF. «Счёт без регистрации» in the cart is an ordinary guest
  `POST /orders` with `INVOICE` + payer (`components/cart/invoiceRequest.vue`).

- **Traffic source on every order and lead** (`attribution/`). The
  storefront records, per page load (`plugins/attribution.client.ts`,
  `utils/attribution.ts`), the first visit ever and the last visit that had a
  source — UTM tags, `yclid`/`gclid`, the external referrer's host, the
  landing path; a direct visit never overwrites a known source, and a source
  older than 90 days is dropped. It is sent as `attribution` with
  `POST /orders`, `/leads` and `/documents/quote`; `traffic-source.ts` (pure,
  tested) labels it «yandex / cpc», «google / organic», «t.me / social»,
  «direct» into `trafficSource` (last non-direct touch) and
  `firstTrafficSource`. Shown in Telegram, the shop letter, the admin order
  and leads; the dashboard sums orders, revenue and leads per source over 90
  days. Reporting only — nothing trusts it.
