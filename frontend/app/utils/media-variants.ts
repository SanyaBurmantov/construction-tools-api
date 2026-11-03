/**
 * Product photos copied to our S3 are stored already resized (backend
 * `media/image-variants.ts`): WebP whose longest side fits a cap of
 * 160/320/640/1200 px, never enlarged. The stored URL names the largest cap
 * the photo has — `…/v/ab/<sha1>/640.webp` means 160, 320 and 640 exist —
 * so a size is picked from the URL alone, with no IPX and no request to the
 * supplier. Any other URL (not copied yet, a banner, a placeholder) is
 * returned as is and keeps going through IPX where a component uses it.
 */
export const VARIANT_CAPS = [160, 320, 640, 1200] as const

const VARIANT_URL = /^(.*\/v\/[0-9a-f]{2}\/[0-9a-f]{40}\/)(\d+)\.webp$/

/** Prefix and largest cap of a stored photo's URL, or null for anything else. */
export function parseVariantUrl(url: string | null | undefined): { prefix: string, top: number } | null {
  const match = url ? VARIANT_URL.exec(url) : null
  if (!match) return null
  const top = Number(match[2])
  return VARIANT_CAPS.includes(top as (typeof VARIANT_CAPS)[number]) ? { prefix: match[1]!, top } : null
}

export function isStoredVariant(url: string | null | undefined): boolean {
  return parseVariantUrl(url) !== null
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
  const cap = VARIANT_CAPS.find(c => c >= need && c <= parsed.top) ?? parsed.top
  return `${parsed.prefix}${cap}.webp`
}

/** `src 1x, src 2x` for a stored photo in a `px`-wide box (one entry when both are the same file). */
export function mediaSrcset(url: string, px: number): string {
  const x1 = mediaSrc(url, px, 1)
  const x2 = mediaSrc(url, px, 2)
  return x1 === x2 ? x1 : `${x1} 1x, ${x2} 2x`
}
