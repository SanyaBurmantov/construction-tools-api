import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * Product photos are stored in S3 already resized, so the storefront serves
 * them as plain files and IPX never touches them (no supplier fetch, no
 * resize on our frontend container).
 *
 * Every photo becomes WebP at a few **caps** — the longest side fits in that
 * many pixels, never enlarged. The storefront's boxes are 44–480 px wide at
 * 1x/2x (cards 300, rows 140, gallery 480, thumbnails 44/60) plus the zoom,
 * and each maps to the smallest cap that covers it:
 *   160 → thumbnails, 320 → cards, 640 → gallery and 2x cards, 1200 → zoom.
 * Caps above the original's own size are not generated — the largest stored
 * one holds the original's pixels — and the stored URL names that largest
 * cap, so the storefront knows which sizes exist from the URL alone
 * (`frontend/app/utils/media-variants.ts` mirrors this file).
 */
export const VARIANT_CAPS = [160, 320, 640, 1200] as const;

const QUALITY = 80;

/** sharp's default lets a 268 MP source through (~1 GB decoded). */
const LIMIT_INPUT_PIXELS = 40_000_000;

sharp.cache(false);
sharp.concurrency(1);

/** `v/ab/<sha1>/` — the folder of one supplier photo's variants. */
export function variantPrefix(sourceUrl: string): string {
  const hash = createHash('sha1').update(sourceUrl).digest('hex');
  return `v/${hash.slice(0, 2)}/${hash}/`;
}

export function variantKey(sourceUrl: string, cap: number): string {
  return `${variantPrefix(sourceUrl)}${cap}.webp`;
}

/** The caps a photo of this size gets: every one below it, plus the first that covers it. */
export function capsFor(longestSide: number): number[] {
  const caps: number[] = [];
  for (const cap of VARIANT_CAPS) {
    caps.push(cap);
    if (cap >= longestSide) break;
  }
  return caps;
}

export type Variant = { cap: number; body: Buffer };

/**
 * The WebP variants of one photo, smallest first. EXIF orientation is
 * applied; transparency is kept (the storefront blends photos onto its
 * surface). Throws on bytes sharp cannot decode.
 */
export async function renderVariants(original: Buffer): Promise<Variant[]> {
  const options = {
    limitInputPixels: LIMIT_INPUT_PIXELS,
    failOn: 'error' as const,
  };
  const meta = await sharp(original, options).metadata();
  if (!meta.width || !meta.height) throw new Error('image without dimensions');
  // autoOrient below swaps the sides of a rotated photo; the longest side
  // is the same either way.
  const longest = Math.max(meta.width, meta.height);
  const variants: Variant[] = [];
  for (const cap of capsFor(longest)) {
    const body = await sharp(original, options)
      .autoOrient()
      .resize({
        width: cap,
        height: cap,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: QUALITY, effort: 4 })
      .toBuffer();
    variants.push({ cap, body });
  }
  return variants;
}

/** Cap of a stored variant key or URL (`…/640.webp`), or null for anything else. */
export function capOfVariant(keyOrUrl: string): number | null {
  const match = /\/v\/[0-9a-f]{2}\/[0-9a-f]{40}\/(\d+)\.webp$/.exec(
    `/${keyOrUrl.replace(/^\/+/, '')}`,
  );
  return match ? Number(match[1]) : null;
}
