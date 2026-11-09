import { Prisma, ProductStatus } from '@prisma/client';
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
 * A slug that keeps a product's code (article) whole however long the name.
 *
 * `slugFromName(name + ' ' + sku)` cut the code off with the tail of a long
 * name, so every article of one series got the same slug: 50 STARFIX clips
 * («Клипса для крепления внутренней обшивки а/м Nissan, Пежо, Рено…») used up
 * `-2` … `-51` and the offer splitter could not part the rest (2026-11-09).
 * The name is cut to leave room, the code goes at the end.
 */
export function slugFromNameAndCode(name: string, code?: string | null) {
  const tail = generateSlug(code ?? '').slice(0, MAX_PRODUCT_SLUG_LENGTH / 2);
  const head = generateSlug(name);
  if (!tail || head.endsWith(`-${tail}`) || head === tail) {
    return slugFromName(name);
  }
  const room = MAX_PRODUCT_SLUG_LENGTH - tail.length - 1;
  let cut = head.slice(0, room);
  if (head.length > room) {
    const dash = cut.lastIndexOf('-');
    if (dash > room / 2) cut = cut.slice(0, dash);
  }
  cut = cut.replace(/-+$/, '');
  return cut ? `${cut}-${tail}` : tail;
}

/**
 * Whether an AI rename may move a product to a slug built from its new name.
 *
 * Only an address no search engine has been given yet. Every product that has
 * been on sale is in the sitemap (Google reads it all) and went to Yandex
 * through IndexNow the moment it was published, and a move costs weeks of
 * indexing even with the 301: in the 2026-10-29 pilot 157 of 200 renamed
 * cards moved, and a week later 27 of the new addresses were indexed against
 * ~44% of the cards that kept theirs. We cannot ask the search engines about
 * 100k URLs (Search Console inspects 2 000 a day), so «was ever public» stands
 * in for «indexed»: a DRAFT has never been shown, anything else has. The name
 * still changes; only the URL stays put.
 *
 * And the URL moves once: after an AI rename (or an admin's hand-set slug) it
 * is ours, or every re-run of a task would leave the page at a new address.
 */
export function aiMayMoveProductUrl(product: {
  status?: unknown;
  aiLockedFields?: unknown;
  lockedFields?: unknown;
}) {
  if (product.status !== ProductStatus.DRAFT) return false;
  const locked = [
    ...((product.aiLockedFields as string[] | undefined) ?? []),
    ...((product.lockedFields as string[] | undefined) ?? []),
  ];
  return !locked.includes('slug');
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
