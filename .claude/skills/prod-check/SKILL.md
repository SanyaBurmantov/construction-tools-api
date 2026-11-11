---
name: prod-check
description: Read-only look at production gost.by — release and container health, memory and disk, whether suppliers are reachable from the box, parser queues and offer freshness, container logs, read-only SQL, and an export of the published catalogue for checking rules on real data. Use when asked "что на проде", "проверь прод", "почему не парсится", "сколько товаров…", before and after a deploy, and before building a feature that depends on what the data really looks like.
---

# prod-check — look at production without changing it

One script, `scripts/prod-check.sh`, runs fixed read-only commands over SSH.
SQL goes through `default_transaction_read_only=on` with a 2-minute statement
timeout, so a write is refused by Postgres itself.

The password is passed inline and never written to a file (the repo is public);
take it from the `prod-server` memory:

```sh
PROD_SSH_PASS='<password>' .claude/skills/prod-check/scripts/prod-check.sh <command>
```

| Command | What it answers |
| --- | --- |
| `status` | Which commit is deployed (`failed` = a rejected release), every container's state, memory/CPU, disk, systemd timers, backup and drill stamps, HTTP health of the home page, catalogue and API |
| `suppliers` | Can the box reach th-tool.by / dukon.by / tools.by: ping, TCP 80/443, HTTPS code |
| `parsers` | Queue rows by status per supplier, job states, the last 12 runs, how old the offers of products on sale are, products by status |
| `logs SERVICE [N]` | Last N (200) lines of `api`, `worker`, `front`, `db`, `caddy` or `detector` |
| `sql 'SELECT …'` | Any read-only query (or SQL on stdin) — table and column names are Prisma's, quoted: `"Product"`, `"priceValue"` |
| `catalog OUT.jsonl` | Every published product as one JSON object per line (~65 MB): id, slug, name, sku, model, barcode, brand, category, price, plus the owning supplier's name and sku |

## How to read it

- **`deployed` ≠ the head of `origin/prod`** → a release is waiting for CI images
  or was rejected; `failed` names the rejected commit.
- **A container "unhealthy" or restarted minutes ago** → `logs` for it; the
  watchdog restarts an unhealthy one after ~6 min.
- **Disk under 2 GB free, a backup stamp older than 26 h, no drill for 8 days**
  → the watchdog alerts on these; say so in the report.
- **`suppliers`: ping ok but TCP "no connect"** → the supplier drops our IP; a
  batch then "finishes" with `saved: 0, failed: 150` and is still recorded as
  `SUCCESS` — look at `result`, not at `status`.
- **`older_7d` close to `offers`** → that supplier's prices are stale.

## Checking a rule on the real catalogue

Rules about products (size variants, compatibility, kinds, brand names) must be
run against real names, not invented strings — in production `model` is empty
and `sku` is the supplier's own number. Export once with `catalog`, keep the
file in the session scratchpad (never in the repo), and run the pure function
over it with a small node script. `supplierName` is the name the rules read
when AI rewrote ours.

## Boundaries

This skill only reads. Anything that changes production — `.env.prod`, a
container restart, a write to the database, a merge into `prod` — is described
to the user first and done only after an explicit yes (see `deploy-prod`).
A heavy query competes with the storefront on a two-core box: add a `LIMIT`,
avoid seq scans over `SourceProduct` in a loop, and run `catalog` once, not per
experiment.
