---
name: claude-edit-products
description: Rewrite product descriptions on gost.by with Claude itself (not DeepSeek) — pick random published products (100 by default, optionally one root category), write unique, fact-only, buyer-relevant descriptionShort/descriptionFull, check them with the site's own validators, uniqueness and the AI detector, give the detector-flagged ones one humanizing pass, and write them to prod through the admin PATCH with a rollback file. Use when asked to "/claude-edit-products", «перепиши описания товаров», «обработай N товаров», «сделай уникальные описания без ИИ-детектора».
---

# /claude-edit-products — Claude rewrites product descriptions

Arguments (all optional): `N` (default **100**), a root category slug
(`krepezh`, `elektroinstrument`… — first segment of `Category.pathKey`; empty
= the whole catalogue), a seed (default: today's date, so a rerun picks other
products).

**One writer, not a swarm.** One subagent writes all N cards in parts of 20
(at most two subagents for N > 100). On 2026-11-09 ten parallel subagents on
100 cards each burned the 5-hour limit in minutes and left most batches
half-done — don't fan out.

**Writing to prod changes the live site.** It needs the owner's «да» for the
run (prod is read-only otherwise — see memory `prod-read-only`). Everything up
to the apply step is read-only.

## What «good» means here (measured, not guessed)

- **Unique**: shingles of 4 content words by stems against the supplier text —
  the site refuses under 50%; Claude's texts reached a median of 100% (DeepSeek
  75–89%). Tools.by/th-tool.by texts sit on dozens of shops (21vek, shop.by,
  toolspro.by… 93–100% copies) — a reworded supplier text competes with all of
  them.
- **Relevant**: facts only from the card's data, for a buyer who is mostly an
  organisation's purchaser: size and pack first, material/coating/standard,
  what base or joint it is for (only if the data says so), what is in the pack.
- **Detector**: on cards the detector is noisy (it gives the suppliers'
  human texts 0.0–1.0 at random; AUC ≈ 0.5 against DeepSeek), so «защита» is
  a best effort, not a guarantee. What lowers the score *and* improves the text:
  uneven rhythm, concrete numbers, no stock phrases. Measured 2026-11-09:
  Claude's fastener texts — median 0.22 (full) against DeepSeek's 0.98–0.99;
  36 of 60 under 0.5 before the humanizing pass. **Never** game it with typos,
  homoglyphs, odd spacing or slang — that breaks search and the validators.

## Steps

Paths: `SK=.claude/skills/claude-edit-products/scripts`, work dir = the
session scratchpad (`$W`). Prod access: `$SK/prod.sh` (SSH key, or the password
in `PROD_SSH_PASS` from the owner — never commit it).

1. **Export** (read-only):
   ```sh
   cat $SK/export.sql | $SK/prod.sh "cat > /tmp/cep.sql && docker cp -q /tmp/cep.sql construction-tools-db:/tmp/cep.sql && \
     docker exec construction-tools-db sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -v n=100 -v root= -v seed=$(date +%F) -f /tmp/cep.sql'" \
     | sed '/^Output format/d;/^Tuples only/d' > $W/cards.json
   ```
   Products whose descriptions an admin or the AI already wrote are skipped
   (`lockedFields`/`aiLockedFields`), the hidden fallback category too. Each
   card carries `supplierShort`/`supplierDescription` (the **source**, never a
   draft), `specs` (paperwork fields removed) and `siblings` (names of the
   other sizes of its line). `$W/cards.json` is also the **rollback file**:
   its supplier texts are what is on the site now.

2. **Brief for the writer**: copy the base rules and the kind guides from
   `backend/src/ai/ai-templates.ts` (`PRODUCT_BASE_RULES`, the matching
   `TEMPLATE_DEFS` guide) into `$W/RULES.md`, plus the writing rules below.

3. **Write — one subagent**, parts of 20 → `$W/out-1.json` … `out-5.json`,
   each `[{id, descriptionShort, descriptionFull}]`. The writing rules:
   - Facts only from the card: every number and Latin code must be in its
     name/specs/supplier text (М/M, х/x fold — the validator knows). No
     unit conversion, no rounding.
   - Own words: never 4+ content words in a row from the supplier text;
     restructure, reorder the facts.
   - First phrase names **this** card's size/pack — the siblings differ only
     there, so their texts must not be copies; never put a sibling's numbers
     in, never the words «вариант»/«линейка».
   - No stock phrases: предназначен, обеспечивает, позволяет, идеально/отлично
     подходит, незаменимый, широкий спектр/диапазон, высокое качество,
     надёжный, долговечный, удобство, эффективный, оптимальный, благодаря,
     является, данный.
   - No invented use cases («для машины», «на даче»), no stock/warranty/
     country/price/contacts unless the data says so (warranty/country only
     when present — and the validator still frowns at claims).
   - Rhythm: short sentences next to long ones, no two sentences starting
     alike, no triple adjectives, no «не только…, но и…».
   - Length: short 1–2 sentences (~100–250 chars); full 1–3 paragraphs by the
     amount of data — a card with little data gets one short paragraph, not
     filler.

4. **Check** — the site's own code, in the API container (nothing is written):
   ```sh
   cat $W/cards.json | $SK/prod.sh 'cat > /tmp/cep-cards.json && docker cp -q /tmp/cep-cards.json construction-tools-api:/tmp/cep-cards.json'
   cat $W/texts.json | $SK/prod.sh 'cat > /tmp/cep-texts.json && docker cp -q /tmp/cep-texts.json construction-tools-api:/tmp/cep-texts.json'
   cat $SK/check.js  | $SK/prod.sh 'cat > /tmp/cep-check.js && docker cp -q /tmp/cep-check.js construction-tools-api:/tmp/cep-check.js && \
     docker exec construction-tools-api node /tmp/cep-check.js /tmp/cep-cards.json /tmp/cep-texts.json' > $W/report.json
   ```
   (`texts.json` = the out parts concatenated.) Verdicts: `pass`; `fail` —
   `validateAnswer` refused it, uniqueness < 50% or a stock phrase; `humanize`
   — passes, but the detector says ≥ 0.8 for a field.

5. **One humanizing pass** for `fail` + `humanize` — the same subagent (or one
   new), only the flagged fields, with the card's data, the current text, the
   problems and the detector figures. Re-run step 4 on the result. Per field
   keep the version that **passes the checks with the lower detector figure**;
   a field that still fails is not written (report it).

6. **Apply** (needs the owner's «да» for this run):
   ```sh
   cat $W/final.json | $SK/prod.sh 'cat > /tmp/cep-apply.json && docker cp -q /tmp/cep-apply.json construction-tools-api:/tmp/cep-apply.json'
   cat $SK/apply.js  | $SK/prod.sh 'cat > /tmp/cep-apply.js && docker cp -q /tmp/cep-apply.js construction-tools-api:/tmp/cep-apply.js && \
     docker exec construction-tools-api node /tmp/cep-apply.js /tmp/cep-apply.json'
   ```
   The admin PATCH locks the fields (`lockedFields` — the daily re-parse won't
   put the supplier text back), moves `contentUpdatedAt` (sitemap lastmod),
   queues IndexNow and leaves an audit row. Check one product on
   `https://gost.by/api/products/<slug>` first, then the rest.
   **Rollback**: build `[{id, descriptionShort: supplierShort,
   descriptionFull: supplierDescription}]` from `$W/cards.json` and run the
   same apply. The fields stay locked after a rollback — unlock in the admin
   if the supplier's updates should flow again.

7. **Mark the texts as AI-written** — always, right after apply, on the same file:
   ```sh
   cat $SK/mark-ai.js | $SK/prod.sh 'cat > /tmp/cep-mark-ai.js && docker cp -q /tmp/cep-mark-ai.js construction-tools-api:/tmp/cep-mark-ai.js && \
     docker exec construction-tools-api node /tmp/cep-mark-ai.js /tmp/cep-apply.json'
   ```
   It adds `descriptionShort`/`descriptionFull` to `Product.aiLockedFields`
   («изменено ИИ»): «Карточек с ИИ-текстами» in /admin/plans counts the card,
   the assistant's autopilot and the «ИИ не писал поле» filter skip it — the
   admin PATCH alone left only `lockedFields`, which AI tasks do not respect,
   so DeepSeek would have rewritten Claude's text. A rollback leaves the mark;
   remove it from `aiLockedFields` too if the supplier text should flow again.

8. **Clean up** `/tmp/cep-*` on the host and in the container
   (`docker exec -u root construction-tools-api rm -f /tmp/cep-*`), report:
   written / not written (why), uniqueness and detector medians, the slugs of
   two or three examples to look at.
