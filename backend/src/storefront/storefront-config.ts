import { BadRequestException } from '@nestjs/common';

/**
 * What an admin curates on the storefront (`/admin/storefront`), stored as
 * JSON in `SiteSetting` under `storefront.*`:
 *
 * - `headerCategories` — the strip under the header on every page (and the
 *   «Популярное:» links on the home page): categories of any level, in this
 *   order, with an optional shorter label and an accent («выделить»).
 * - `popularProducts` — the home page's «Выбирают покупатели» row.
 *
 * An empty list means «automatic»: the strip falls back to the first root
 * categories, the row to the best-rated products — what the site did before
 * either was curated. Pure, so the rules are tested without a database.
 */
export type HeaderCategoryPick = {
  categoryId: string;
  /** Shown instead of the category's name; null = the name. */
  label: string | null;
  /** Accent colour in the strip, like «Акции». */
  highlight: boolean;
};

export type StorefrontConfig = {
  headerCategories: HeaderCategoryPick[];
  popularProducts: string[];
};

export const KEY_HEADER_CATEGORIES = 'storefront.headerCategories';
export const KEY_POPULAR_PRODUCTS = 'storefront.popularProducts';

export const MAX_HEADER_CATEGORIES = 20;
export const MAX_POPULAR_PRODUCTS = 24;
export const MAX_LABEL_LENGTH = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stored JSON → config; anything unreadable counts as «not curated». */
export function parseStoredConfig(
  stored: Map<string, string>,
): StorefrontConfig {
  return {
    headerCategories: safe(() =>
      normalizeHeaderCategories(
        JSON.parse(stored.get(KEY_HEADER_CATEGORIES) ?? '[]'),
      ),
    ),
    popularProducts: safe(() =>
      normalizeProductIds(JSON.parse(stored.get(KEY_POPULAR_PRODUCTS) ?? '[]')),
    ),
  };
}

function safe<T>(read: () => T[]): T[] {
  try {
    return read();
  } catch {
    return [];
  }
}

/**
 * The admin's list as sent: ids checked, labels trimmed and capped,
 * duplicates dropped (first wins). Throws 400 on a malformed body.
 */
export function normalizeHeaderCategories(
  input: unknown,
): HeaderCategoryPick[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException('headerCategories должен быть списком');
  }
  if (input.length > MAX_HEADER_CATEGORIES) {
    throw new BadRequestException(
      `Не больше ${MAX_HEADER_CATEGORIES} категорий в полосе`,
    );
  }
  const seen = new Set<string>();
  const out: HeaderCategoryPick[] = [];
  for (const item of input) {
    const row = (item ?? {}) as Record<string, unknown>;
    const categoryId = typeof row.categoryId === 'string' ? row.categoryId : '';
    if (!UUID.test(categoryId)) {
      throw new BadRequestException('Неверный id категории');
    }
    if (seen.has(categoryId)) continue;
    seen.add(categoryId);
    const label =
      typeof row.label === 'string'
        ? row.label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH)
        : '';
    out.push({
      categoryId,
      label: label || null,
      highlight: row.highlight === true,
    });
  }
  return out;
}

export function normalizeProductIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException('popularProducts должен быть списком');
  }
  if (input.length > MAX_POPULAR_PRODUCTS) {
    throw new BadRequestException(
      `Не больше ${MAX_POPULAR_PRODUCTS} популярных товаров`,
    );
  }
  const out: string[] = [];
  for (const id of input) {
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new BadRequestException('Неверный id товара');
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
