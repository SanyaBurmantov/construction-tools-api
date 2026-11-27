/**
 * Product photos copied to our S3 are stored already resized (backend
 * `media/image-variants.ts`): WebP whose longest side fits a cap of 320 or
 * 640 px, never enlarged. The stored URL names the largest cap the photo
 * has — `…/v/ab/<sha1>/640.webp` means 320 and 640 exist — so a size is
 * picked from the URL alone, with no IPX and no request to the supplier.
 * Any other URL (not copied yet, a banner, a placeholder) is returned as is
 * and keeps going through IPX where a component uses it.
 *
 * Until 2026-11-27 there were four caps (160/320/640/1200). The 160 and 1200
 * files are deleted (S3 room), but a URL naming 1200 may still sit in an old
 * order line or a cached page, so it is read as «320 and 640»; a set whose
 * only file is a 160 (a tiny original) keeps it. Same rules as the backend's
 * `media/variant-url.ts`.
 */
export const VARIANT_CAPS = [320, 640] as const

/** Every cap a stored URL may name, the two old ones included. */
const KNOWN_CAPS = [160, 320, 640, 1200]

const VARIANT_URL = /^(.*\/v\/[0-9a-f]{2}\/[0-9a-f]{40}\/)(\d+)\.webp$/

/** Prefix and largest cap of a stored photo's URL, or null for anything else. */
export function parseVariantUrl(url: string | null | undefined): { prefix: string, top: number } | null {
  const match = url ? VARIANT_URL.exec(url) : null
  if (!match) return null
  const top = Number(match[2])
  return KNOWN_CAPS.includes(top) ? { prefix: match[1]!, top } : null
}

export function isStoredVariant(url: string | null | undefined): boolean {
  return parseVariantUrl(url) !== null
}

/** The sizes on disk for a set whose URL names `top`. */
function storedCaps(top: number): number[] {
  if (top < VARIANT_CAPS[0]) return [top]
  return VARIANT_CAPS.filter(cap => cap <= top)
}

/**
 * The URL of the smallest stored size that covers `px` CSS pixels
 * (`px * density` device pixels); the largest one when none does. A URL that
 * is not a stored photo is returned unchanged.
 */
export function mediaSrc<T extends string | null | undefined>(url: T, px: number, density = 1): T | string {
  const parsed = parseVariantUrl(url)
  if (!parsed) return url
  const need = px * density
  const caps = storedCaps(parsed.top)
  const cap = caps.find(c => c >= need) ?? caps[caps.length - 1]!
  return `${parsed.prefix}${cap}.webp`
}

/**
 * The largest stored size — for whatever shows a photo as it is (the zoom,
 * og:image, schema.org) and must never name a deleted 1200.
 */
export function mediaLargest<T extends string | null | undefined>(url: T): T | string {
  return mediaSrc(url, Number.POSITIVE_INFINITY)
}

/** `src 1x, src 2x` for a stored photo in a `px`-wide box (one entry when both are the same file). */
export function mediaSrcset(url: string, px: number): string {
  const x1 = mediaSrc(url, px, 1)
  const x2 = mediaSrc(url, px, 2)
  return x1 === x2 ? x1 : `${x1} 1x, ${x2} 2x`
}
