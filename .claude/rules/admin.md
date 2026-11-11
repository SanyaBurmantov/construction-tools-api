---
paths:
  - "frontend/app/pages/admin/**"
  - "frontend/app/layouts/admin.vue"
  - "frontend/app/components/admin/**"
  - "frontend/app/composables/useAdmin*.ts"
  - "frontend/app/composables/useParserQueue.ts"
  - "frontend/app/composables/useProductSources.ts"
  - "frontend/app/composables/useFeature.ts"
  - "backend/src/admin/**"
  - "backend/src/audit/**"
  - "backend/src/errors/**"
  - "backend/src/features/**"
  - "backend/src/plans/**"
  - "backend/src/common/dto/**"
---

# Admin panel

The admin shell and page skeleton, the parsing screen, source notes, feature flags, audit trail, error log, plans.

- **Admin UI**: one shell in `app/layouts/admin.vue` — a single auth gate plus
  the sidebar. The gate is a **login + password form** for an ADMIN account
  (`useAuth().login()`, then `GET /admin/stats`), not the old `ADMIN_TOKEN`
  field; a signed-in non-admin gets the "нет прав" screen instead of the form.
  Admin pages share one skeleton: `<AdminPageHead>` + `.admin-page` /
  `.admin-form*` (`assets/scss/admin.scss`), `useAdminList()` for paged lists
  (page changes only through `setPage()`, so a filter change loads once and a
  stale answer is dropped), `useAdminAction().run()` for
  request → toast → reload, `<UiConfirm>` for confirmations, `<UiTable>` for
  tables. `/admin/stats` is shared by the sidebar and the dashboard through
  `useAdminStats()`.
  **An open admin tab hears about new leads and orders** without a reload:
  `layouts/admin.vue` short-polls `GET /admin/inbox` every 15 s
  (`useAdminInbox.ts` — four small counts plus the newest lead/order; never
  `/admin/stats`, the heaviest query in the app) only while the tab is
  visible, and immediately when it is shown again. A newer number toasts
  «Новая заявка №…» / «Новый заказ №…», updates the sidebar badges, puts
  «(N)» in the tab title, and bumps `leadsVersion`/`ordersVersion`, on which
  `/admin/leads` and `/admin/orders` reload in the background
  (`useAdminList().refresh()`, no skeleton) — new leads glow for 20 s.
  Admin pages just set `definePageMeta({ layout: 'admin' })` and can assume the
  session is valid; do **not** re-add per-page token forms. `useAdminApi()`
  rides on the session cookie (same-origin, plus `X-Requested-With`) and
  exposes `hasSession` instead of a token; the UI never holds one. Accounts live in `/admin/users`:
  `users/index.vue` lists and creates them, `users/[id].vue` is one account —
  profile, figures, **current orders with an inline status select** and the
  finished ones in a table (`GET /admin/users/:id` returns all of it). The
  admin order list and detail also show which account placed an order, linking
  back to that page; a guest order says so.
  `/admin/parsing` is the one screen split into components
  (`components/admin/parsing/*`: `sourceControl`, `cronHealth`, `runHistory`,
  `queuePanel`, `categoryQueuePanel`, `sourceSummary`, `dataQuality`,
  `importProduct`, `errorLog`) — it was 2000 lines of five unrelated screens.
  **State and every request stay on the page**; the panels take props and emit
  intent, so there is still one place that knows what is loaded and one place
  that reloads it after an action. A supplier queue is a controller object from
  `composables/useParserQueue.ts` (one factory per source), and the **list of
  them is built from `/parser/overview`** — which carries each source's `host`
  and the `queuePrefix` its queue endpoints sit under. It used to be four
  hard-coded lines, so a fifth supplier would have parsed with no queue on
  screen; that is why `PARSER_SOURCES` is the only place a supplier is
  declared. The
  chrome the panels share (`.pad`, `.stat-row`, `.toolbar`, `.pagination` …) is
  styled once on the page with `:deep()` rather than copied into nine scoped
  stylesheets.

- **"Откуда спаршен" is admin-only, and visible everywhere a product is**
  (`components/admin/productSourceNote.vue` + `composables/useProductSources.ts`):
  the storefront product page (banner above everything), catalogue cards and
  rows, the admin product list and an order's lines. The data comes from
  `GET /admin/products/sources?ids=…` behind `AdminGuard`, so a regular
  visitor cannot obtain supplier URLs or our costs even though the same
  storefront component renders them for an admin — and for a non-admin the
  request is never fired. Ids are **batched on a 50 ms tick** through one
  shared cache, so a 24-card grid is one request, and a product with no offers
  is cached as an empty answer instead of being re-requested forever.

- **Feature flags** (`features/`, `/admin/features` «Фичи»). Declared in
  code (`features/feature-flags.ts`, mirrored as defaults in
  `composables/useFeature.ts`) — a flag is added with the code that checks
  it and removed with it; `SiteSetting feature.<key>` holds only an admin's
  choice: `off` | `admins` (a signed-in ADMIN only) | `on`. The storefront
  reads them **client-side** (`plugins/features.client.ts`, `GET /features`)
  so cached shared HTML is never per-visitor; the backend checks with
  `FeatureFlagsService.isOn(key, isAdmin)` (module is `@Global()`). Two kill
  switches today: `cart-suggestions`, `client-error-reports`.

- **Admin audit trail** (`audit/`, `AdminActionLog`, `/admin/audit`). Worth
  having only now that admins are accounts — under the shared token there was
  no "who". `AdminActionLogInterceptor` is registered **globally** (admin
  routes live in six controllers across four modules) and records a request
  when it is mutating **and** in admin scope: an ADMIN session, the
  `x-admin-token` header, or a path under `/admin` — that last one is what
  meant to capture attempts the guard rejected — but guards run *before*
  interceptors, so a rejected request never reaches it; those 401/403s on
  `/admin` are recorded by the exception filter into the error log instead.
  Reads are not logged, or the log would be dashboard polling. Bodies
  are stored with `password`/`token`/`secret`/`authorization` replaced by
  `[redacted]`, long arrays summarised and the whole thing truncated at 4 KB:
  it is evidence of what changed, not a replayable payload. A failed audit
  write is logged and swallowed — it must never turn a successful admin action
  into an error. `ADMIN_LOG_TTL_DAYS` (180) bounds the table.

- **Error log** (`errors/`, `ErrorLog`, `/admin/errors`). The audit says who
  changed what; this says what *broke*. `HttpExceptionFilter` is now registered
  through `APP_FILTER` in `AppModule` (not `useGlobalFilters` in `main.ts`) so
  it can be given `ErrorLogService` by DI — the response it sends is unchanged.
  What it keeps: **every 5xx**, plus the client errors an **admin-scope**
  request was answered with (400/405/409/413/415/422), plus **401/403 on
  `/admin` paths** — the only record of rejected admin attempts. A non-HTTP
  error's own message goes to the log only; the client gets
  `Internal server error` (it used to receive Prisma's invocation text).
  Bodies go through the audit's own redaction, so a password cannot land in a
  table an admin reads, and a stack is kept for 5xx only. Two bounds, both
  deliberate: a repeat of the same `status+method+path+message` inside 60 s
  bumps `occurrences` on the row it already wrote instead of inserting (one
  broken endpoint under load must not write a row per request), and
  `ERROR_LOG_TTL_DAYS` (30) prunes the rest. `GET /admin/stats` carries
  `recentErrors` (5xx in the last 24 h) for the sidebar badge.
  **Blank optional fields**: an untouched form input arrives as `''`, which
  `@IsOptional()` does *not* skip — so every optional text field with a minimum
  length rejected a valid blank form ("companyName must be longer than or equal
  to 2 characters" when creating an admin). Create DTOs run
  `@Transform(emptyToUndefined)` (`common/dto/`); update DTOs keep accepting
  `''`, because there it is the only way to clear a value.

- **Планы и цели** (`plans/`, `PlanItem`, `/admin/plans` «Планы», 05.11 —
  the owner wanted the project's to-do list in the admin, not in chat). A
  GOAL may name a measure (`plans/plan-metrics.ts`: orders / company orders /
  revenue / profit ≈15% / leads this Minsk month, visits — Metrika's people
  count, our counter as fallback —, products on sale, products with AI
  texts) and a `target`; the value is **counted live on every read**, never
  typed in, and only for keys some goal uses. Never rename a metric key —
  it is stored in the row. A TASK may belong to a goal (only to a GOAL — a
  goal has no parent, a task no measure; the service enforces it), carries a
  due date, assignee, priority and **screenshots**: uploaded through
  `POST /admin/media/upload?kind=screenshot` (one WebP ≤ 2400 px under
  `s/<sha1>`, readable text; public by exact key like every media object,
  listing closed) from the button, a drop or Ctrl+V in the form, and saved
  into `attachments` at once on an existing item. The migration seeded the
  plans as they stood on 05.11; the goals' targets are starting points.
