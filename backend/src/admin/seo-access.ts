import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/auth-request';

/**
 * The SEO specialist's part of the admin.
 *
 * `AdminGuard` lets an SEO session through **only** where a route (or its
 * controller) carries `@SeoAccess()`; every other admin route stays ADMIN
 * only, so a route added tomorrow is closed to the role by default. What the
 * role gets: plans, traffic and search reports, AI texts, media upload, and
 * the product / category / brand screens — where it may change only the
 * fields below and never sees our costs or which supplier sells what.
 */
export const SEO_ACCESS = 'seoAccess';
export const SeoAccess = () => SetMetadata(SEO_ACCESS, true);
/** Closes one route of a `@SeoAccess()` controller again (spending switches). */
export const AdminOnly = () => SetMetadata(SEO_ACCESS, false);

/** Fields of each entity an SEO specialist may change. */
export const SEO_EDITABLE_FIELDS = {
  product: [
    'name',
    'slug',
    'descriptionShort',
    'descriptionFull',
    'seoTitle',
    'seoDescription',
    'variantLine',
    'variantLabel',
  ],
  category: ['name', 'description', 'image', 'seoTitle', 'seoDescription'],
  brand: ['description', 'country', 'logo', 'seoTitle', 'seoDescription'],
} as const;

export type SeoEntity = keyof typeof SEO_EDITABLE_FIELDS;

const FIELD_LABELS: Record<string, string> = {
  priceValue: 'цена',
  oldPrice: 'старая цена',
  costPrice: 'закупочная цена',
  pricingMode: 'режим цены',
  status: 'статус',
  stockStatus: 'наличие',
  stockQuantity: 'остаток',
  categoryId: 'категория',
  brandId: 'бренд',
  sku: 'артикул',
  model: 'модель',
  parentId: 'родительская категория',
  slug: 'адрес',
  name: 'название',
  sortOrder: 'порядок',
  isVisible: 'видимость',
  isFeatured: 'на главной',
};

export function isSeoRequest(request: AuthenticatedRequest): boolean {
  return request.authUser?.role === UserRole.SEO;
}

/**
 * The fields of `dto` an SEO specialist may not change but did. The admin
 * forms send every field on every save, so a field equal to the stored value
 * is not a change.
 */
export function forbiddenSeoChanges(
  entity: SeoEntity,
  dto: object,
  stored: object,
  differs: (value: unknown, stored: unknown) => boolean,
): string[] {
  const allowed = new Set<string>(SEO_EDITABLE_FIELDS[entity]);
  const sent = dto as Record<string, unknown>;
  const current = stored as Record<string, unknown>;
  return Object.keys(sent).filter(
    (key) =>
      sent[key] !== undefined &&
      !allowed.has(key) &&
      differs(sent[key], current[key]),
  );
}

export function assertSeoChanges(fields: string[]): void {
  if (!fields.length) return;
  const names = fields.map((f) => FIELD_LABELS[f] ?? f).join(', ');
  throw new ForbiddenException(
    `SEO-специалист меняет только тексты и SEO-поля. Не сохранено: ${names}`,
  );
}

/** A product as the SEO specialist sees it: no costs, no supplier offers. */
export function productForSeo<T extends object | null>(product: T): T {
  if (!product) return product;
  const {
    costPrice: _cost,
    sourceProducts: _offers,
    priceReviewNeeded: _review,
    ...rest
  } = product as Record<string, unknown>;
  return rest as T;
}
