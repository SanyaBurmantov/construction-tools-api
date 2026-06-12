# CLAUDE.md

Guidance for working in this repository. Read this first.

## What this project is

Construction-tools catalog. It continuously parses products from supplier sites,
normalizes them into a shared catalog shape, and serves a public storefront.

- **backend/** — NestJS 11 API (TypeScript), Prisma 5 + PostgreSQL, the parsers.
- **frontend/** — Nuxt 4 (Vue 3, Vuetify + Nuxt UI), SSR with ISR/SWR route rules.
- **deploy/**, `docker-compose*.yml`, `deploy-prod.sh` — Docker deploy (db + backend + frontend + Caddy).

## Hard requirements

- **Node ≥ 22** (`.nvmrc` = 22.12.0). The Nuxt build fails on Node < 22 with
  `crypto.hash is not a function`. Docker images use `node:22-bookworm-slim`.
- PostgreSQL 15.

## Commands

Backend (`cd backend`):
- `npm run start:dev` — watch mode (needs a running DB; `npm run start:db-docker` starts one).
- `npm run build` — `nest build`.
- `npm run lint` — ESLint (prettier rules are enforced as errors; `npm run lint -- --fix`).
- `npm test` — Jest; `npm test -- --runInBand` for the parser specs.
- Prisma: `npx prisma migrate dev --name <change>` (dev), `npx prisma migrate deploy` (prod), `npx prisma generate`.

Frontend (`cd frontend`):
- `npm run dev` / `npm run build` / `npm run lint`.

Dev stack: `docker compose up` (root). Prod: see the `deploy-prod` skill.

## Architecture notes

- **Auth**: admin endpoints are guarded by `AdminGuard`, which checks the
  `x-admin-token` header against `ADMIN_TOKEN`. There is **no JWT** — the
  `@nestjs/jwt` / `passport-jwt` deps and `JWT_SECRET` env are dead code.
- **API routing in prod**: Caddy serves `/api/*` → strips `/api` → `backend:8000`;
  everything else → `frontend:3000`. Client calls use base `/api`
  (`NUXT_PUBLIC_API_BASE`); SSR calls go through the Nuxt server route
  `frontend/server/api/[...path].ts` → `API_BASE_SERVER` (`http://backend:8000`).
- **Frontend ISR**: `nuxt.config.ts` `routeRules` — home/catalog `isr: 300`,
  product `isr: 900`, admin `ssr: false`. Cached HTML is served cheaply; runtime
  is light. The build is the memory-heavy step.
- **Data model**: products are stored in two layers — `Product` (normalized
  storefront card) and `SourceProduct` (raw supplier snapshot, identity
  `@@unique([sourceId, url])`). See the parsing docs below.
- **Catalog browsing**: categories are a tree (parsers build it from supplier
  breadcrumbs; products attach to leaves). Public API: `GET /categories/tree`
  (aggregated counts, empty branches pruned), `GET /categories/:slug`
  (ancestors + children for a category page), `GET /brands/:slug/categories`.
  `GET /products` filters by `categorySlug`/`categoryId` **including the whole
  subtree**, supports comma-separated `brandId`, `inStock`, and returns
  filter-aware facets (each dimension excluded from its own counts) plus
  `facets.priceRange`. Frontend: `/catalog` + `/catalog/<category-slug>` pages
  share `components/catalog/CatalogView.vue`; filters live in query params
  (`brands`, `source`, `priceMin/Max`, `inStock`, `sort`, `page`).
- **Storefront orders**: guest checkout (no accounts). The cart lives client-side
  (Pinia `stores/cart.ts`, persisted to `localStorage`); `POST /orders`
  (`orders/` module) re-prices every line from the DB (never trusts the client),
  validates published/priced products, computes delivery cost, and snapshots
  product name/slug/image/price into `OrderItem`. Admin manages orders via
  `GET /admin/orders`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status`.
  Delivery costs are env-tunable (`DELIVERY_COST_COURIER`, `DELIVERY_COST_POST`).

## Database / migrations

- Schema is in `backend/prisma/schema.prisma`. Migrations in
  `backend/prisma/migrations`, starting from a squashed baseline
  `00000000000000_init`. The original pre-baseline migrations are archived in
  `backend/prisma/_migrations_archive_pre_baseline/` and are **not** applied.
- Prod containers run `prisma migrate deploy` on start (backend Dockerfile CMD).
- Add schema changes as new migrations and commit them. Never re-introduce
  `prisma db push` for prod.

## Parsing (the core of this project)

The full flow and the step-by-step playbook for adding a new supplier live in:
- `.claude/skills/add-parser/SKILL.md` — **how to add a new parser** (main skill).
- `.claude/skills/parser-ops/SKILL.md` — run / debug / monitor parsers.
- `SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md` — field-by-field normalization rules.

One-paragraph map: a per-source **queue model** (`Sitemaps<Source>`) holds product
URLs with a `status`. `refreshSitemaps()` fills it from the site's sitemap.xml;
`processSitemapsBatch()` pops `PENDING` rows and calls `parseProductUrl()`, which
fetches HTML, runs a pure `parse<Source>(html)` function (cheerio + JSON-LD),
upserts `Product` + images + specs + `SourceProduct`, and marks the row
`DONE` / `SKIPPED` / `FAILED`. Crons in `sites/<source>.cron.ts` drive this on a
schedule, gated by env flags, writing health to `ParserRuntimeStatus`
(exposed at `GET /health/parser`).

Canonical, complete example to copy from: **`backend/src/parser/sites/7745-source.parser.ts`**
(service) + `7745.parser.ts` (pure parse fn) + `7745.cron.ts` (cron).

## Conventions

- Match the surrounding NestJS style: `@Injectable()` services, constructor DI,
  Prisma via `PrismaService`. Pure HTML→data functions are kept separate from the
  DB-writing service and unit-tested against fixtures in `sites/fixtures/`.
- Keep parser HTTP polite: real user-agent, request delay, batch ≤ 30, concurrency 1.
- Slugs via `common/utils/generate-slug.ts`; bounded concurrency via
  `common/utils/run-with-concurrency.ts`.

## Don't

- Don't commit `.env` / `.env.prod` (gitignored) or build artifacts
  (`backend/dist`, `frontend/.output`, `frontend/.nuxt`).
- Don't run `npm run build` for the frontend on Node < 22.
- Don't overwrite manual `HIDDEN` / `ARCHIVED` product statuses on re-parse.
