import { Prisma } from '@prisma/client';

/** Exactly the fields needed to derive/invalidate compatibility. */
export const RELATION_IDENTITY_SELECT = {
  id: true,
  name: true,
  categoryId: true,
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
    take: 40,
    select: {
      valueNorm: true,
      specification: { select: { canonicalKey: true, name: true } },
    },
  },
} satisfies Prisma.ProductSelect;

/** Fixed aliases only. SQL and compatibilitySignature() must stay identical. */
export function signatureSql(alias: 'a' | 'p') {
  const column = (name: string) => Prisma.raw(`"${alias}"."${name}"`);
  const columns = [
    'name',
    'categoryId',
    'brandId',
    'model',
    'sku',
    'descriptionShort',
    'descriptionFull',
  ].map((name) => Prisma.sql`coalesce(${column(name)}, '')`);
  return Prisma.sql`md5(concat_ws(chr(31), ${Prisma.join(columns)}, coalesce(array_to_string(${column('aiLockedFields')}, chr(30)), '')))`;
}
