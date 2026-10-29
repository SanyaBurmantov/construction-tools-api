import { Prisma } from '@prisma/client';
import { generateSlug } from '../common/utils/generate-slug';

type Db = Prisma.TransactionClient;

/**
 * A URL slug for a product name. Cut at a word boundary: a 200-character name
 * makes a URL nobody can read, and search engines show the start anyway.
 */
export const MAX_PRODUCT_SLUG_LENGTH = 90;

export function slugFromName(name: string) {
  const full = generateSlug(name);
  if (full.length <= MAX_PRODUCT_SLUG_LENGTH) return full;
  const cut = full.slice(0, MAX_PRODUCT_SLUG_LENGTH);
  const dash = cut.lastIndexOf('-');
  return (
    dash > MAX_PRODUCT_SLUG_LENGTH / 2 ? cut.slice(0, dash) : cut
  ).replace(/-+$/, '');
}

/**
 * Whether `slug` can become this product's URL: no other product has it, and
 * it is not another product's old URL (that one must keep redirecting there).
 * This product's own old URL is fine — moving back to it drops the redirect.
 */
export async function isProductSlugFree(
  db: Db,
  slug: string,
  productId: string,
) {
  const [product, redirect] = await Promise.all([
    db.product.findUnique({ where: { slug }, select: { id: true } }),
    db.productRedirect.findUnique({
      where: { slug },
      select: { productId: true },
    }),
  ]);
  return (
    (!product || product.id === productId) &&
    (!redirect || redirect.productId === productId)
  );
}

/** `base`, else `base-2`, `base-3`… — the first one free for this product. */
export async function freeProductSlug(db: Db, base: string, productId: string) {
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (await isProductSlugFree(db, slug, productId)) return slug;
  }
  return null;
}

/**
 * After a product moved from `from` to `to`: the old URL keeps answering with
 * a 301 (`ProductRedirect`, which the product page turns into a redirect).
 * The new slug may have been one of this product's old URLs; a slug cannot be
 * a product and a redirect at once, so that redirect goes.
 */
export async function redirectOldSlug(
  db: Db,
  productId: string,
  from: string,
  to: string,
) {
  if (from === to) return;
  await db.productRedirect.deleteMany({ where: { slug: to } });
  await db.productRedirect.upsert({
    where: { slug: from },
    create: { slug: from, productId },
    update: { productId },
  });
}

/** Moves a product to a new URL, leaving a 301 on the old one. */
export async function moveProductSlug(
  db: Db,
  productId: string,
  from: string,
  to: string,
) {
  if (from === to) return;
  await db.product.update({ where: { id: productId }, data: { slug: to } });
  await redirectOldSlug(db, productId, from, to);
}
