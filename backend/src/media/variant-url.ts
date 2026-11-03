/**
 * Stored photo sizes and how a URL names them — no sharp here, so letters
 * and other plain code can pick a size without loading the image library.
 * The storefront has the same rules in `frontend/app/utils/media-variants.ts`.
 */
export const VARIANT_CAPS = [160, 320, 640, 1200] as const;

const VARIANT_URL = /^(.*\/v\/[0-9a-f]{2}\/[0-9a-f]{40}\/)(\d+)\.webp$/;

/** Cap of a stored variant key or URL (`…/640.webp`), or null for anything else. */
export function capOfVariant(keyOrUrl: string): number | null {
  const match = VARIANT_URL.exec(`/${keyOrUrl.replace(/^\/+/, '')}`);
  if (!match) return null;
  const cap = Number(match[2]);
  return (VARIANT_CAPS as readonly number[]).includes(cap) ? cap : null;
}

/**
 * The smallest stored size covering `px` device pixels (never above the
 * largest the URL names); any other URL is returned unchanged.
 */
export function variantUrlFor(url: string, px: number): string {
  const match = VARIANT_URL.exec(url);
  const top = match ? Number(match[2]) : NaN;
  if (!match || !(VARIANT_CAPS as readonly number[]).includes(top)) return url;
  const cap = VARIANT_CAPS.find((c) => c >= px && c <= top) ?? top;
  return `${match[1]}${cap}.webp`;
}
