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
`ImageMirrorService` in the worker, every 20 s, 40 photos, 4 at a time —
but **at most 6 through a proxy, one at a time**, `PROXIED_PER_TICK`,
asked through `SupplierConnectionService.goesThroughProxy`; the walk stops
at the first one over budget and the next tick resumes there). th-tool.by's
88k photos (2026-11-23) can only come through its paid proxy
(`parser.proxyImages`); at 40 a tick that is 120 requests a minute — a bill,
and a ban of the proxy would stop th-tool parsing as well. ~3.5 days at this
pace. Before switching `proxyImages` on, check S3 room (see «Two sizes» below).
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
sharp, one photo at a time): WebP whose longest side fits 320/640,
never enlarged, under `v/ab/<sha1 of the URL>/<cap>.webp`, smallest written
first; `ProductImage.url` names the **largest cap written**, so the URL alone
says which sizes exist and an existing set is found by HEAD (largest first)
and never downloaded twice. The storefront picks a size from it
(`utils/media-variants.ts`, `mediaSrc`/`mediaSrcset`): `ProductThumb` renders a
stored photo as a plain `<img srcset>` straight from the bucket — **no IPX,
no supplier** — and every other URL (not copied yet) takes the old
IPX → direct → placeholder path, so a half-copied catalogue keeps working.
The small `<img>`s (cart, header search, compare, account…) ask
`mediaSrc(url, px, 2)`; the zoom, og:image (through IPX, crawlers only) and
schema.org take `mediaLargest(url)` — never the raw URL, which may still
name a deleted 1200.
**Two sizes, not four (owner, 2026-11-27).** hoster.by's MinIO answered
507 `XMinioStorageFull` at ~22 GB of a 50 GB plan (2026-11-15) and again at
24 GB of a 65 GB one (2026-11-26): 1.15 M files (300k photos × 160/320/640/
1200, a 160 ≈ 2.4 KB) were counted as the whole plan — most likely raw disk
with redundancy and a minimum block per file, so **the file count costs, not
the bytes** (support blamed incomplete multipart uploads; there were none —
we never use multipart). 160 and 1200 went: thumbnails take 320, the
gallery at 2x and the zoom take 640. Old URLs naming 1200 are read as
«320 + 640» on both sides (`variant-url.ts` / `utils/media-variants.ts`,
`storedCaps`); a set whose only file is a 160 (a tiny original, 113 of them)
keeps it. `MediaSlimService` (worker, every 15 s, 200 sets, cursor in
SiteSetting `media.slim.cursor`, `done:<when>` at the end) HEADs the kept
files, rewrites `ImageMirror.key/bytes` and `ProductImage.url` to the 640
**before** deleting 160 + 1200 in one DeleteObjects, and moves the cursor
only after; at the end it renames 1200 URLs in `ProductImage`, `OrderItem`
and `Category`. Deletes work while MinIO refuses writes. The originals are
not kept, so a dropped size comes back only by re-downloading from the
suppliers (th-tool only through the paid proxy) — don't add a cap lightly. Bytes are sniffed (a 200 HTML page
is not a photo), placeholders are never copied (so the placeholder checks on
`url` keep working), a failed photo retries after 30/60 min then every 3
days, a host that does not answer is skipped for 30 min, candidates are walked
in `sourceUrl` order from an in-memory cursor over `ProductImage_sourceUrl_idx`
(~30 ms a tick; the first version grouped all ~244k image rows every 20 s —
3.3 s each), a pass with nothing to do rests 10 min, and `S3_MEDIA_MAX_GB` (30 of the 50 GB plan) stops it — it counts our
bytes from `ImageMirror`, not the hoster's: on 2026-11-15 the storage said
full (507 `XMinioStorageFull`) at ~22 GB of 50, so a 507 also pauses copying
for 30 min with its own alert, instead of downloading photos to throw away. The worker
creates the bucket and sets its policy itself: **objects are public-read by
exact key, listing is closed** (owner's choice, 2026-11-02) — IPX fetches
them like any other source (`image.domains` has the S3 host). The backups
bucket stays private. Progress: `GET /admin/media/stats`, «Фото в нашем
хранилище» on `/admin/parsing`. The S3 client is our own SigV4
(`common/utils/s3-client.ts`, tested against AWS's documented example) —
no `@aws-sdk` for a handful of requests. Not done yet: deleting objects no
product uses any more (~2k sets, 0.14 GB on 2026-11-27); admin uploads'
old 160/1200 files stay (a handful).
**Admins upload pictures into the same bucket** (`MediaUploadService`,
`POST /admin/media/upload?kind=image|banner`, multipart `file`, ≤15 MB, in
the API process): an `image` (category tile, any picture shown through
`ProductThumb`) is cut into the same caps under `v/ab/<sha1 of the bytes>/`,
a `banner` is one WebP ≤1920 px under `b/`. `<AdminImageUpload>` sits beside
the link field in `/admin/banners` and `/admin/categories`; the field still
takes a pasted link.
