/**
 * Telling a supplier's "no photo" asset apart from a real product photo.
 *
 * A photo-less product on th-tool.by still renders a gallery — filled with the
 * theme's own `/themes/<name>/img/default.png`. The parsers reject those now,
 * but roughly 12% of the catalogue was imported before they learned to, and
 * nothing cleared the rows: such a product parses to *zero* images, and the
 * parser's "never wipe a gallery on a flaky re-parse" rule then kept the
 * placeholder forever.
 *
 * So the rule has to apply to what is already stored, not only to a fresh
 * parse — and in one place, because the storefront reads product images from
 * several: the catalogue card, the gallery, `og:image`, the product JSON-LD
 * and the cart line snapshot.
 */
export const PLACEHOLDER_IMAGE_MARKERS = [
  '/themes/',
  '/default.',
  'no_photo',
] as const;

/** True for a supplier's placeholder asset rather than a product photo. */
export function isPlaceholderImageUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return PLACEHOLDER_IMAGE_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

/**
 * Drops placeholder rows from a product's gallery.
 *
 * Returns an empty array rather than a fallback: "no photo" is what the
 * storefront's own placeholder is for, and it is also what the admin
 * data-quality report counts.
 */
export function withoutPlaceholderImages<T extends { url: string }>(
  images: T[],
): T[] {
  return images.filter((image) => !isPlaceholderImageUrl(image.url));
}
