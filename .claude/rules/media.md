---
paths:
  - "backend/src/media/**"
  - "backend/src/common/utils/s3-client.ts"
  - "frontend/app/utils/media-variants.ts"
  - "frontend/app/utils/og-image.ts"
  - "frontend/app/components/product/productThumb.vue"
  - "frontend/app/components/admin/imageUpload.vue"
---

# Product photos and uploads (S3)

The image mirror, stored WebP sizes, how the storefront picks one, admin uploads.

**Product photos live in our S3, not at the supplier** (`media/`,
`ImageMirrorService` in the worker, every 20 s, 40 photos, 4 at a time).
Every photo used to be hot-linked from the supplier and re-fetched by IPX on
each browser-cache miss, so a supplier blocking our server (th-tool.by,
2026-11-01), deleting a delisted product's photo or being slow emptied or
slowed our catalogue. Now `ProductImage.url` is **what the storefront shows**
— our copy in `S3_MEDIA_BUCKET` once stored, the supplier's URL until then —
and `ProductImage.sourceUrl` is **always the supplier's**: parsers write it,
and anything that filters on what the supplier served (dukon's junk-image
cleanup) matches `sourceUrl`. Parsers recreate image rows on every parse, so
`ProductIdentityService.save()` swaps a stored copy in (`withStoredImages`) —
without it the daily re-parse put the supplier URL back. State is
`ImageMirror` keyed by the supplier URL (it outlives the image rows).
**Stored already resized, the original is not kept** (`image-variants.ts`,
sharp, one photo at a time): WebP whose longest side fits 160/320/640/1200,
never enlarged, under `v/ab/<sha1 of the URL>/<cap>.webp`, smallest written
first; `ProductImage.url` names the **largest cap written**, so the URL alone
says which sizes exist and an existing set is found by HEAD (largest first)
and never downloaded twice. The storefront picks a size from it
(`utils/media-variants.ts`, `mediaSrc`/`mediaSrcset`): `ProductThumb` renders a
stored photo as a plain `<img srcset>` straight from the bucket — **no IPX,
no supplier** — and every other URL (not copied yet) takes the old
IPX → direct → placeholder path, so a half-copied catalogue keeps working.
The small `<img>`s (cart, header search, compare, account…) ask
`mediaSrc(url, px, 2)`; the zoom gets the largest cap; og:image still goes
through IPX (crawlers only). Measured on real photos: original ~65 KB, all
four sizes together ~60 KB, a catalogue card's file ~6 KB — the whole
catalogue is ~15 GB. Bytes are sniffed (a 200 HTML page
is not a photo), placeholders are never copied (so the placeholder checks on
`url` keep working), a failed photo retries after 30/60 min then every 3
days, a host that does not answer is skipped for 30 min, candidates are walked
in `sourceUrl` order from an in-memory cursor over `ProductImage_sourceUrl_idx`
(~30 ms a tick; the first version grouped all ~244k image rows every 20 s —
3.3 s each), a pass with nothing to do rests 10 min, and `S3_MEDIA_MAX_GB` (30 of the 50 GB plan) stops it. The worker
creates the bucket and sets its policy itself: **objects are public-read by
exact key, listing is closed** (owner's choice, 2026-11-02) — IPX fetches
them like any other source (`image.domains` has the S3 host). The backups
bucket stays private. Progress: `GET /admin/media/stats`, «Фото в нашем
хранилище» on `/admin/parsing`. The S3 client is our own SigV4
(`common/utils/s3-client.ts`, tested against AWS's documented example) —
no `@aws-sdk` for four requests. Not done yet: deleting objects no product
uses any more.
**Admins upload pictures into the same bucket** (`MediaUploadService`,
`POST /admin/media/upload?kind=image|banner`, multipart `file`, ≤15 MB, in
the API process): an `image` (category tile, any picture shown through
`ProductThumb`) is cut into the same caps under `v/ab/<sha1 of the bytes>/`,
a `banner` is one WebP ≤1920 px under `b/`. `<AdminImageUpload>` sits beside
the link field in `/admin/banners` and `/admin/categories`; the field still
takes a pasted link.
