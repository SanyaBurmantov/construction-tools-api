---
name: seo-measure
description: Measure how gost.by is doing in Google — re-run the indexing comparison of rewritten product texts against their control groups (Claude-rewritten cards, the DeepSeek pilot), and take a Search Console snapshot (clicks, impressions, position, sitemap). Use when asked "замерь индексацию", "как там пилот", "что в Search Console", "понижают ли нейротексты", or when a re-measure date from the open-items memory has come.
---

# seo-measure — indexing and search numbers from Google

Everything goes through `scripts/gsc.mjs` (read-only, no dependencies). The
service-account key lives only in the `gsc-service-account` memory file — pass
its path, never copy the key into the repo:

```sh
export GSC_MEMORY=<memory dir>/gsc-service-account.md NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
```

URL Inspection is limited to 2 000 URLs a day; one experiment is ~400.

## 1. Claude-rewritten cards (baseline 2026-11-10)

200 rewritten products against 186 untouched ones from the same categories;
addresses did not change.

```sh
D=ai-pilot/claude-edit-2026-11-10
node scripts/gsc.mjs inspect $D/groups.json $D/google-$(date +%F).json --prev $D/google-2026-11-10.json
```

## 2. DeepSeek pilot (2026-10-29)

200 pilot products against 200 control ones (`ai-pilot/selection.json`). AI
renamed 157 of the pilot products and their addresses moved, so inspect where
each product lives now:

```sh
node scripts/gsc.mjs inspect ai-pilot/selection.json ai-pilot/google-$(date +%F).json --resolve
```

The first measurement (2026-11-05) was not saved as a file: 46/200 pilot and
86/200 control were indexed; among pilot products that kept their address
19/43, among the moved ones 27/157. Give the same split — rows that moved carry
`movedTo`. From the second run on, pass the previous file as `--prev`.

## 3. Search Console snapshot

```sh
node scripts/gsc.mjs search --days 28     # clicks, impressions, CTR, position per day and in total
node scripts/gsc.mjs sitemaps             # is the sitemap read, how many URLs, errors
```

Reference point, 2026-11-05: 136 clicks / 3 180 impressions over the first 8
days, position ~11, 106k URLs in the sitemap.

## Reading the result

- **Compare the change of each group, not the shares.** The groups differed on
  day one (32.5% against 24.2% for the Claude experiment); what matters is
  which one gained more since the baseline.
- **A difference of a few products is noise.** With 200 per group, call it an
  effect only when the gap in change is well beyond ±10 products, and say so
  when it is not.
- **A moved address resets indexing for weeks** — never fold moved and unmoved
  pilot products into one number.
- Requests refused by quota are printed and count as "not indexed": if there
  are any, re-run the next day rather than report the figure.
- Yandex is not measured: there is no Webmaster token. Say that the result is
  Google only.

## After the measurement

1. Commit the new `google-<date>.json` next to its baseline (it holds URLs and
   Google's verdicts, no secrets) and add a line with the date and the figures
   to the experiment's README.
2. Update the memory: the date in `open-items`, the result in
   `claude-edit-products` or `ai-texts-deepseek`.
3. Report the numbers with the caveats above; whether rewritten texts help or
   hurt is the user's question — answer it only as far as the data goes.
