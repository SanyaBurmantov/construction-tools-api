---
paths:
  - "backend/src/auth/**"
  - "backend/src/admin/**"
  - "backend/src/sources/**"
  - "backend/src/common/**/*guard*"
  - "frontend/app/composables/useAuth.ts"
  - "frontend/app/composables/useAdminApi.ts"
  - "frontend/app/plugins/auth.client.ts"
  - "frontend/app/pages/login.vue"
  - "frontend/app/pages/register.vue"
  - "frontend/app/pages/verify-email.vue"
  - "frontend/app/layouts/admin.vue"
---

# Auth, sessions and roles

Accounts, the session cookie, CSRF, sign-in limits and TOTP, the SEO role, AdminGuard, what is public on purpose.

- **Auth = accounts + an opaque session token** (`auth/`). `User` has a
  normalized unique `login` (an e-mail works as one), a `role`
  (`CUSTOMER` | `ADMIN`) and a `customerType` (`INDIVIDUAL` | `COMPANY`, the
  физ/юр лицо choice made at registration — a COMPANY must give
  `companyName`). `POST /auth/register` always mints a **CUSTOMER**: an ADMIN
  can only be created from `/admin/users`, so the storefront can never
  self-promote. Login issues a random 256-bit token stored in `UserSession` as
  a **SHA-256 hash** — a dump cannot be replayed, and deleting the row logs
  that device out immediately, which a JWT could not. That is why there is
  still no JWT and no `@nestjs/jwt`.
  **The browser gets the token only as an HttpOnly cookie** (`sid`,
  `auth/session-cookie.ts`; audit/security.md #3): `SameSite=Lax`, host-only
  (no `Domain`), `Expires` = the `UserSession.expiresAt`, `Secure` in
  production (`AUTH_COOKIE_SECURE=true|false` overrides), and **`Path=/api`**
  — every browser API call is under `/api` (Caddy in prod, Nuxt's
  `server/api/[...path].ts` proxy in dev) and no page request is, so SSR never
  sees the cookie and cannot render per-user data into the cached, shared
  HTML. Don't widen it to `/`. The login/register body carries no token; a
  script that wants one sends `X-Auth-Transport: bearer` and gets it in the
  body (no cookie). Guards read `Authorization: Bearer` first, then the cookie;
  logout, logout-all and account deletion clear it, a dead cookie is cleared
  on the 401, and a password change keeps this device's session (and cookie)
  while ending the others. **CSRF**: a *cookie*-authenticated non-GET request
  (and login/register from a foreign Origin) must carry `X-Requested-With`
  or an Origin/Referer equal to `PUBLIC_ORIGIN`/`CORS_ORIGIN`/the request host
  (`X-Forwarded-Host` first), else 403 — `assertNotCrossSite()`. Bearer and
  `x-admin-token` callers are exempt: a browser never attaches those itself.
  The frontend sends `API_REQUEST_HEADERS` (`useAuth.ts`) on every API call.
  Passwords are **scrypt** from `node:crypto` (`auth/password.util.ts`,
  parameters stored alongside each hash) — no native build step, so the
  `node:22-slim` images need no toolchain; bcrypt would.
  **Sign-in is limited per account and can ask for a code.** Five failed
  attempts in a row (password or code) lock that account's sign-in for 15
  min whatever the address (`LOGIN_MAX_FAILURES`, `User.loginLockedUntil`;
  the per-IP `@Throttle` alone let a spread-out guess go on). Any account can
  switch on a **TOTP second factor** (`auth/totp.util.ts`, RFC 6238 on
  `node:crypto`, tested against the RFC vectors): `/account` → «Вход с кодом
  из приложения» (`POST /auth/totp/setup|enable|disable`; off needs password
  *and* code); then `POST /auth/login` answers 401 `OTP_REQUIRED` to the
  password alone and both login forms show the code field; a code works once
  (`totpLastStep`). A lost phone: `/admin/users/:id` → «Снять блокировку
  входа» (`POST /admin/users/:id/unlock-sign-in`, not on yourself through a
  session; the `x-admin-token` path can).
  **A third role, `SEO`** (05.11, `admin/seo-access.ts`): the SEO
  specialist enters the admin but `AdminGuard` lets that session through
  **only** on routes marked `@SeoAccess()` (route or controller;
  `@AdminOnly()` closes one route of an open controller again) — a new admin
  route is closed to the role by default. Open: plans, traffic/search
  reports, AI texts (the assistant's job switches, limits and «шаг сейчас»
  stay ADMIN — they spend the DeepSeek balance), media upload, and the
  product / category / brand list + PATCH, where `assertSeoEdit` refuses
  any changed field outside `SEO_EDITABLE_FIELDS` (403 naming them; the
  forms send every field, so an unchanged one passes) and `productForSeo`
  drops `costPrice`, `sourceProducts`, `priceReviewNeeded`. The layout
  filters the menu (`SEO_PATHS`), sends `/admin` to `/admin/plans`, shows
  «Раздел только для администратора» elsewhere, never loads stats/inbox; the
  forms disable what the role cannot change. Granted in `/admin/users`.
  `AdminGuard` now accepts **either** an ADMIN session **or** the old
  `x-admin-token: $ADMIN_TOKEN` header, which stays the service-to-service
  path (the runbook/CI curl commands depend on it, and it is the rescue path
  when nobody can log in). A valid non-admin session gets **403**, not 401, so
  the UI keeps the login instead of bouncing to the sign-in screen.
  Side effects worth keeping: a password change or an admin disabling an
  account deletes that user's sessions on the spot; the last active admin
  cannot be demoted, disabled or deleted, and nobody can do any of it to
  themselves. `AuthModule` is `@Global()` on purpose — `AdminGuard` is
  instantiated in five modules, and that beats re-registering `AuthService` in
  each or importing AdminModule (circular).
  **Guarding the public surface** (checked when roles landed): every mutating
  endpoint outside `/auth` and `/account` is behind `AdminGuard`;
  `POST /orders`, `POST /products/:slug/reviews`, `POST /cart/validate` and
  `POST /promo-codes/validate` are public on purpose (guests order, review and
  re-price carts) and carry their own `@Throttle` — the promo one is 20/min
  because it answers "does this code exist". `GET /sources` is **behind
  `AdminGuard`** and returns `{id, name, code}` only — the supplier's `url` is
  internal, the same rule as supplier prices, and *which supplier carries what*
  is internal too: the «Поставщик» facet in the catalogue filters is rendered
  for an ADMIN session alone (`CatalogView` fetches the list only then, never
  on the server — storefront HTML is cached and shared), and `?source=` in the
  URL is **ignored for everyone else** — hiding the facet while the parameter
  still filtered meant an admin's link could quietly show a customer one
  supplier's goods with nothing in the UI saying so. The API enforces it too:
  `GET /products` runs under `OptionalAuthGuard` and drops `sourceCode` unless
  the session is an ADMIN (it used to filter for anyone with curl). `GET /products` carries no
  `facets.sources` at all: counting it was one semi-join over `SourceProduct`
  per supplier on every listing *and* every client-side filter change (those
  are not cached), for numbers only an admin would ever see — so the admin
  facet lists the suppliers without counts. The dead public `GET /source-products` (an in-memory array
  that always answered `[]`, shaped to hand out supplier URLs and costs) was
  removed rather than guarded. `GET /orders/:id` stays public by unguessable
  UUID — a guest needs the confirmation page — and projects out PII.
  **The first admin is created at boot** by `auth/admin-bootstrap.service.ts`
  when no active ADMIN exists: login `ADMIN_LOGIN` (default `admin`), password
  `ADMIN_PASSWORD` or, when that is unset, the committed
  `INITIAL_ADMIN_PASSWORD` (`test-111`) — so the first sign-in is known in
  advance instead of having to be looked up in `.env.prod`. That is the
  trade-off on purpose: a known initial password, changed from inside
  `/admin/users` after the first login. `ADMIN_TOKEN` is **not** a password
  fallback any more; it is only the service header. The bootstrap never
  touches an existing account — a changed password stays changed, and a
  deliberately deleted admin is not resurrected while another one is active.

- **Storefront accounts**: `composables/useAuth.ts` is the single session
  (HttpOnly cookie, so script never sees the token; "signed in" is learned
  from `GET /auth/me` in `plugins/auth.client.ts`, skipped for guests by a
  non-secret `auth-session` hint in localStorage; a leftover `auth-token`
  from the Bearer era is deleted on load). Pages `/login`, `/register` and `/account` are
  `ssr: false` — there is nothing to render on the server. The header shows the
  account action (or "Войти") and, **for an ADMIN only, a link to the admin
  panel**; both are inside `<ClientOnly>` because the session is client-side.
