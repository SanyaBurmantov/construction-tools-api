import type { Prisma, ProductStatus, StatusSource } from '@prisma/client';

/**
 * Which products have a page (owner, 2026-11-06).
 *
 * A product the *system* hid — no supplier carries it right now
 * (`OffersService.delistOffer`) or its category was filtered out — used to
 * answer «Страница не найдена» until a supplier listed it again, and search
 * engines dropped the URL meanwhile. Its page now stays up as «нет в
 * наличии», without a price, with a request form and alternatives; it is
 * still kept out of listings, search and the sitemap.
 *
 * Anything an admin decided (HIDDEN/ARCHIVED with `statusSource: ADMIN`) and
 * a DRAFT (never on sale) still 404. So does a product no supplier has shown
 * for `UNAVAILABLE_PAGE_DAYS`: by then it is gone, not out of stock.
 */
export const UNAVAILABLE_PAGE_DAYS = 180;

/** `where` for every lookup behind a product page (card, similar, reviews). */
export const PRODUCT_PAGE_WHERE = {
  OR: [{ status: 'PUBLISHED' }, { status: 'HIDDEN', statusSource: 'SYSTEM' }],
} satisfies Prisma.ProductWhereInput;

export type ProductPageState = 'on-sale' | 'unavailable' | 'gone';

export function productPageState(
  product: { status: ProductStatus; statusSource: StatusSource },
  /** The newest supplier sync of any of its offers. */
  lastSeen: Date | null,
  now: Date = new Date(),
): ProductPageState {
  if (product.status === 'PUBLISHED') return 'on-sale';
  if (product.status !== 'HIDDEN' || product.statusSource !== 'SYSTEM') {
    return 'gone';
  }
  if (!lastSeen) return 'gone';
  const ageDays = (now.getTime() - lastSeen.getTime()) / 86_400_000;
  return ageDays <= UNAVAILABLE_PAGE_DAYS ? 'unavailable' : 'gone';
}
