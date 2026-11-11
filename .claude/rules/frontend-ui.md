---
paths:
  - "frontend/app/components/**"
  - "frontend/app/assets/**"
  - "frontend/app/utils/**"
  - "frontend/app/types/**"
  - "frontend/app/pages/**"
  - "frontend/app/layouts/**"
---

# Frontend: design system and shared vocabulary

Tokens and Ui* primitives (the only UI layer), shared utils, date formatting, API types.

- **Frontend design system**: tokens in `app/assets/scss/tokens.scss` (semantic
  layer; light only — the never-enabled dark theme was removed); primitives in `app/components/ui/*` (`UiButton`, `UiInput`,
  `UiModal`, `UiTable`, `UiPrice`, `UiRating`, …). Components read tokens, never
  raw hex. **It is the only UI layer** — Vuetify, Nuxt UI and Tailwind were all
  installed and all unused (zero `<v-…>`, one `<UApp>` wrapper, no utility
  classes) once these 24 primitives took over; removing the three cut the build
  from 247 s to 140 s and the client bundle from 7.5 MB to 1.3 MB. Don't add a
  component library back — add a primitive here. `app/assets/scss/main.scss` keeps aliases for the pre-token variable
  names. Toasts: `useAppToast()` + the single `<UiToaster>` in the layout.
  Icons: `<UiIcon name>` (one path map) — don't paste inline `<svg>`.
  `UiInput type="password"` renders its own show/hide toggle.
  Shared vocabulary lives in `app/utils/` — `order-labels.ts` (order status /
  delivery / payment / customer type labels, `nextOrderStatuses`),
  `product-status.ts`, `slugify.ts` (same transliteration as the backend),
  `safe-storage.ts` (storage that never throws), `form-values.ts`
  (`numOrNull`/`textOrNull`: on an update send `null` for a cleared field —
  `undefined` is dropped from the JSON and the backend reads it as "no
  change"; `toLocalInput`/`fromLocalInput` for `datetime-local`),
  `category-options.ts` (tree-ordered selects). `useSite()` gives `siteUrl` /
  `apiBase`, `usePageSeo()` the title/og/canonical set.

- **Dates are formatted in one place**, `app/utils/format-datetime.ts`
  (`formatDate`, `formatDay`, `formatDateTime`, `…WithYear`, `…WithSeconds`).
  Six screens each built their own `Intl.DateTimeFormat('ru-BY', …)`. A screen
  that needs the year or seconds imports that variant under the local name
  `formatDateTime`; everything else takes the default from auto-import.

- **API shapes are declared once**, in `app/types/api.ts` (`Brand`/`AdminBrand`,
  `Banner`/`AdminBanner`, `Order`/`AdminOrder`, `OrderItem`, `OrderStatus`,
  `Paginated<T>`, `ProductsResponse`) and `app/types/parsing.ts` for the
  admin parsing screens. They used to be re-declared in every page that fetched
  them — five copies of `Brand` — so a new field had to be added in five files
  and missing one was invisible to the linter and the build. Add the field
  here; pages import it. `CatalogProduct` and `CategoryNode` stay in their
  composables on purpose: they live next to the logic that consumes them.
