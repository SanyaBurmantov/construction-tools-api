/**
 * Stored photo sizes and how a URL names them — no sharp here, so letters
 * and other plain code can pick a size without loading the image library.
 * The storefront has the same rules in `frontend/app/utils/media-variants.ts`.
 */

/**
 * The sizes a photo is stored at now. 160 and 1200 were dropped
 * (owner, 2026-11-27): hoster.by counts the space of every small file far
 * above its bytes, and 1.15 M files filled a 65 GB plan with 24 GB of data.
 * 320 also serves the 44–60 px thumbnails, 640 the gallery and the zoom.
 */
export const VARIANT_CAPS = [320, 640] as const;

/**
 * Every cap a stored URL may name: the current two plus 160 and 1200 of the
 * first sets (`MediaSlimService` rewrites those and deletes the files).
 */
export const KNOWN_CAPS = [160, 320, 640, 1200] as const;

const VARIANT_URL = /^(.*\/v\/[0-9a-f]{2}\/[0-9a-f]{40}\/)(\d+)\.webp$/;

/**
 * The sizes on disk for a set whose URL names `top`: the current caps up to
 * it. A set whose top is 160 (an original that small) keeps its one file.
 */
export function storedCaps(top: number): number[] {
  if (top < VARIANT_CAPS[0]) return [top];
  return VARIANT_CAPS.filter((cap) => cap <= top);
}

/** Prefix and the cap a stored variant key or URL names, or null. */
export function parseVariant(
  keyOrUrl: string,
): { prefix: string; top: number } | null {
  const match = VARIANT_URL.exec(keyOrUrl);
  if (!match) return null;
  const top = Number(match[2]);
  return (KNOWN_CAPS as readonly number[]).includes(top)
    ? { prefix: match[1], top }
    : null;
}

/** Cap of a stored variant key or URL (`…/640.webp`), or null for anything else. */
export function capOfVariant(keyOrUrl: string): number | null {
  return parseVariant(`/${keyOrUrl.replace(/^\/+/, '')}`)?.top ?? null;
}

/**
 * The smallest stored size covering `px` device pixels (the largest stored
 * one when none does); any other URL is returned unchanged.
 */
export function variantUrlFor(url: string, px: number): string {
  const parsed = parseVariant(url);
  if (!parsed) return url;
  const caps = storedCaps(parsed.top);
  const cap = caps.find((c) => c >= px) ?? caps[caps.length - 1];
  return `${parsed.prefix}${cap}.webp`;
}
