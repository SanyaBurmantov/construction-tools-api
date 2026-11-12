/**
 * The social preview image (Telegram, Viber, VK, Facebook) for a photo: our
 * own URL, 1200×630 — the size every network crops to — with the product
 * centred on white instead of cut off. The supplier's original is 1200×900 on
 * their server, so a shared link previewed a cropped photo from somebody
 * else's domain.
 */
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

/** The site-wide preview (public/og-image.png), 1200×630. */
export const DEFAULT_OG_IMAGE = '/og-image.png'

/**
 * A path of ours as an absolute URL. og:image must be absolute — Telegram,
 * VK and Facebook do not resolve `/og-image.png` against the page, and that
 * is what the home page, /brand and /sales carried (SEO audit, 12.11).
 */
export function absoluteImageUrl(siteUrl: string, src: string): string {
  if (/^https?:\/\//.test(src)) return src
  if (src.startsWith('//')) return `https:${src}`
  return `${siteUrl.replace(/\/$/, '')}/${src.replace(/^\/+/, '')}`
}

/** og:image / twitter:image when a page has no picture of its own. */
export function defaultOgImageUrl(siteUrl: string): string {
  return absoluteImageUrl(siteUrl, DEFAULT_OG_IMAGE)
}

export function ogImageUrl(siteUrl: string, src: string | null | undefined): string | undefined {
  if (!src) return undefined
  // A relative path is already ours (the default og-image.png).
  if (!/^https?:\/\//.test(src)) return absoluteImageUrl(siteUrl, src)
  return `${siteUrl.replace(/\/$/, '')}/_ipx/f_jpeg&q_85&fit_contain&b_ffffff&s_${OG_IMAGE_WIDTH}x${OG_IMAGE_HEIGHT}/${src}`
}

/** «4810992031625 (4811207007213)» → the GTIN-8/12/13/14 schema.org wants. */
export function gtinFromBarcode(barcode: string | null | undefined): { key: string, value: string } | null {
  const code = barcode?.match(/\d{8,14}/)?.[0]
  if (!code) return null
  const key = { 8: 'gtin8', 12: 'gtin12', 13: 'gtin13', 14: 'gtin14' }[code.length]
  return key ? { key, value: code } : null
}
