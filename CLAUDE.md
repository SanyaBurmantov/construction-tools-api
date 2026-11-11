# CLAUDE.md

Guidance for working in this repository. Read this first.

## What this project is

gost.by — a construction-tools catalogue for business buyers. It continuously
parses products from supplier sites (th-tool.by, dukon.by, tools.by),
normalizes them into a shared catalogue and serves a public storefront.

- **backend/** — NestJS 11 API (TypeScript), Prisma 5 + PostgreSQL 15, the
  parsers. One codebase, two processes: `api` (HTTP only) and `worker` (every
  cron, the parsers, the AI runner) — `PROCESS_ROLE`.
- **frontend/** — Nuxt 4 (Vue 3), SSR with ISR/SWR route rules. No UI library:
  `app/components/ui/*` + `assets/scss/tokens.scss` is the whole design system.
- **detector/** — optional Python container (AI-text detector), off by default.
- **deploy/**, `docker-compose*.yml` — Docker deploy (db + backend + worker +
  frontend + Caddy) on one small box (2.9 GB RAM); images are built by GitHub
  Actions, the `prod` branch auto-deploys.

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
- `npm run dev` / `npm run build` / `npm run lint` / `npm test`.

Dev stack: `docker compose up` (root). Prod: see the `deploy-prod` skill.

## Where the knowledge lives

The detail — why each thing is the way it is, usually an incident — is split by
area into `.claude/rules/*.md`. Each file loads by itself when you open code it
covers (`paths:` in its frontmatter). **Before changing an area, read its
file** — also when you got there by search rather than by opening a file.

| Area | File in `.claude/rules/` |
| --- | --- |
| API/worker split, containers, memory guards, releases, uptime, postmortems | `infra.md` |
| Migrations (expand → contract), backups, restore drills, DB role | `database.md` |
| Accounts, session cookie, CSRF, TOTP, SEO role, `AdminGuard`, what is public | `auth.md` |
| Parsers: queue, reliability, runtime settings, each supplier, text cleanup | `parsing.md` |
| Product / category identity, supplier offers, merges and splits | `catalog-identity.md` |
| Category tree, facets, curated blocks, home page, default order, SEO bits | `catalog-storefront.md` |
| Search (Russian FTS, synonyms, search journal) | `search.md` |
| Pricing engine | `pricing.md` |
| Orders, terms of sale, cart, lists, promo codes, account, B2B documents | `orders.md` |
| Telegram, outbox, e-mail | `notifications.md` |
| Reviews and spam defence | `reviews.md` |
| «Похожие», compatibility, fit by standard, size variants | `recommendations.md` |
| Product photos in S3, admin uploads | `media.md` |
| ISR, page cache, canonical/legacy URLs, outage screens, sitemaps | `frontend-rendering.md` |
| Design system, shared utils and types | `frontend-ui.md` |
| Admin shell, parsing screen, feature flags, audit, error log, plans | `admin.md` |
| Speed/SLOs, our traffic counter, Metrika | `analytics.md` |
| AI text tasks (DeepSeek), templates, checks, IndexNow | `ai-tasks.md` |
| AI assistant (eight background jobs) | `ai-assist.md` |
| AI detector, uniqueness, typograf | `ai-detector.md` |

Also: skills `add-parser`, `parser-ops`, `deploy-prod`, `claude-edit-products`
(`.claude/skills/`); `SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md` (field-by-field
normalization); `feature.md` (recommendations in depth); `detector/README.md`;
`docs/postmortems/`.

**Keeping it this way.** New knowledge goes into the topic file, next to what
it protects — not here. This file holds only what is true for every task: keep
it under ~150 lines. A new area gets a new file with `paths:` and a row in the
table above.

## Invariants

The rules most expensive to break. Each is explained in its topic file.

**Catalogue data**
- Product identity is the supplier offer `SourceProduct(sourceId, url)`, not
  `Product.slug`: anything creating products from a parse goes through
  `ProductIdentityService.save()`.
- Category identity is `Category.pathKey`: build the tree only through
  `CategoryTreeService.upsertBranch()`; re-parent / re-slug / merge only
  through `categories/category-path-alias.ts`.
- **`PricingService` is the sole owner of `Product.priceValue` and
  `oldPrice`.** Parsers never write a price, a status or `costPrice`.
- Admin and AI edits survive the re-parse (`lockedFields`, `aiLockedFields`);
  never overwrite a status an admin set (`statusSource: ADMIN`).
- Only barcode and brand+sku auto-merge products; a merge must move reviews
  and price history (they cascade on delete).
- We import every supplier category (owner, 2026-11-05) — don't bring category
  filters back. `7745.by` was never a supplier — don't bring it back either.

**Security and privacy**
- Supplier URLs, supplier names per product and our costs never reach the
  storefront or a public API — admin-only.
- The session cookie is `Path=/api` so SSR never sees it: nothing per-user may
  be rendered into the cached, shared HTML. Don't widen it to `/`.
- Every mutating endpoint outside `/auth` and `/account` is behind
  `AdminGuard`; a new admin route is closed to the `SEO` role unless marked
  `@SeoAccess()`.
- No JWT, no bcrypt, no axios, no `@aws-sdk` — each was left out on purpose.

**Processes and operations**
- **No step may require a human to press a button**: crons, self-healing and
  retries, not admin actions.
- The API never runs a parser job (the per-source lock lives in the worker); a
  new boot pass or cron must check `runsBackgroundJobs()`.
- Parser settings are runtime (`ParserSettingsService`: DB row → env → default)
  — never `process.env` at module load. A supplier is declared once, in
  `PARSER_SOURCES`.
- Outbound HTTP goes through `fetchWithTimeout`; Telegram and mail never throw
  into a request.
- Migrations are expand → contract (a rollback runs old code on the new
  schema); never `prisma db push` for prod.
- A batch pass never loads text columns in bulk (select ids, then one row at a
  time); no `_count` of a big relation in a list query's include.

**Storefront**
- One UI layer: the `Ui*` primitives and tokens. Don't add a component library;
  keep component styles `scoped`; icons through `<UiIcon>`.
- One URL per page: lowercase, no trailing slash — write internal links so.
- Nothing may render a category whose count is 0; recommendations prefer
  relevance to a full row (an empty block is right, a filler is not).
- «Пусто» and «не ответило» are different screens: an outage is a 503, never
  a 404 or an empty shop.
- The page cache is the bounded LRU (`server/storage/bounded-*.ts`) — don't
  swap it for Nitro's plain memory driver.
- Temporarily organisations and ИП only (owner, 2026-11-06): registration is
  COMPANY with a УНП, `POST /orders` takes `INVOICE` only.

**AI**
- AI changes text fields only (`ai/ai-fields.ts`); a field is written after
  the checks or not at all; a product that was ever on sale keeps its URL.
- Assistant jobs are off by default and spend money only when switched on.

**Stored keys — never rename**: Metrika goal ids, plan metric keys, feature
flag keys. **Bump the version when rules change**: `SIMILAR_RULE_VERSION`,
`COMPATIBILITY_RULE_VERSION`, `FITMENT_RULE_VERSION`. `FTS_DOCUMENT_SQL` and
`uniqueness-sql.ts` must stay byte-identical to their migrations.

## Conventions

- Match the surrounding NestJS style: `@Injectable()` services, constructor DI,
  Prisma via `PrismaService`. Pure HTML→data functions are kept separate from the
  DB-writing service and unit-tested against fixtures in `sites/fixtures/`.
- Keep parser HTTP polite: real user-agent, request delay, concurrency 1. Batch
  size is per source (`cron.<code>.batchLimit`): dukon and th-tools use 300, but
  a batch is just how long a run lasts — the 3 s delay and one request at a time
  are what keep the rate polite.
- Slugs via `common/utils/generate-slug.ts`; bounded concurrency via
  `common/utils/run-with-concurrency.ts`.
- Pure logic lives in its own module with a spec beside it; check a rule on
  the real catalogue, not only on invented strings.
- After an outage customers noticed, write a postmortem in `docs/postmortems/`
  (`TEMPLATE.md`); the rule it taught goes into the topic file.

## Don't

- Don't commit `.env` / `.env.prod` (gitignored) or build artifacts
  (`backend/dist`, `frontend/.output`, `frontend/.nuxt`).
- Don't run `npm run build` for the frontend on Node < 22.
- Don't overwrite manual `HIDDEN` / `ARCHIVED` product statuses on re-parse.
