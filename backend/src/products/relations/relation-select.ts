import { Prisma } from '@prisma/client';

/** Exactly the fields needed to derive/invalidate compatibility. */
export const RELATION_IDENTITY_SELECT = {
  id: true,
  name: true,
  brandId: true,
  model: true,
  sku: true,
  descriptionShort: true,
  descriptionFull: true,
  aiLockedFields: true,
} satisfies Prisma.ProductSelect;

/** Allowlist: no costs, supplier rows, prose or relation evidence in cards. */
export const RECOMMENDATION_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  sku: true,
  priceValue: true,
  oldPrice: true,
  priceCurrency: true,
  stockStatus: true,
  stockQuantity: true,
  ratingAvg: true,
  ratingCount: true,
  brand: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: { order: 'asc' },
    take: 2,
    select: { url: true, alt: true },
  },
} satisfies Prisma.ProductSelect;

export const SIMILARITY_SELECT = {
  ...RECOMMENDATION_CARD_SELECT,
  brandId: true,
  categoryId: true,
  productSpecs: {
    where: {
      valueNorm: { not: null },
      specification: { canonicalKey: { not: null } },
    },
    orderBy: { specificationId: 'asc' },
    // Enough to compare; every product page loads this for ~48 candidates.
    take: 16,
    select: {
      valueNorm: true,
      specification: { select: { canonicalKey: true, name: true } },
    },
  },
} satisfies Prisma.ProductSelect;

const column = (alias: string, name: string) =>
  Prisma.raw(`"${alias}"."${name}"`);
const text = (alias: string, name: string) =>
  Prisma.sql`coalesce(${column(alias, name)}, '')`;

/**
 * Fixed aliases only. Must stay identical to accessorySignature() /
 * targetSignature() in compatibility.ts — same fields, order, separators.
 */
export function accessorySignatureSql(alias: 'a') {
  return Prisma.sql`md5(concat_ws(chr(31), ${text(alias, 'name')}, ${text(alias, 'descriptionShort')}, ${text(alias, 'descriptionFull')}, coalesce(array_to_string(${column(alias, 'aiLockedFields')}, chr(30)), '')))`;
}

export function targetSignatureSql(alias: 'p') {
  return Prisma.sql`md5(concat_ws(chr(31), ${text(alias, 'name')}, ${text(alias, 'brandId')}, ${text(alias, 'model')}, ${text(alias, 'sku')}))`;
}
