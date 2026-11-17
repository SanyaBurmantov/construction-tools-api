/**
 * b2bit.by — pure functions over its JSON API, no DB and no HTTP.
 *
 * b2bit.by is the B2B portal of «АйТи Дистрибуция»; we are its dealer
 * «МультиТул». The site is a React app over `api.b2bit.by/api/v1`, so there is
 * no HTML to scrape: the parser logs in, reads the category tree, the category
 * listings and `/product/<id>`, and these functions turn the answers into our
 * shape.
 *
 * Things that are not what they look like:
 * - **The price we sell at is the struck-through one** (owner, 2026-11-17).
 *   An offer carries three numbers: `price` — our dealer (purchase) price,
 *   `price_old` — the price the portal shows crossed out next to it, and
 *   `price_rrc` — the manufacturer's recommended retail. We sell at
 *   `price_old` (≈ ×1.33 of the purchase price, always under the RRP). It is
 *   *not* a "was" price for our storefront — nothing is shown struck through
 *   on our side. An offer without one (no promotion, ~1.5 %) has no price for
 *   us: the card goes priceless, as agreed with the owner.
 * - The product's own `available` flag is false even for items in stock; the
 *   offer's `available` is the one that says «можно купить» (`reserve`
 *   offers are `available: false`).
 * - The listing id (`product.id`, the one in `/product/<id>`) is not the
 *   price-list id (`ext_id`, «ID b2bit.by» in the CSV).
 * - `description` is the spec values joined by « / » without their names —
 *   «15000 / 82.0 / аккумулятор / 18» — useless as text, never imported.
 * - Characteristics come in groups that repeat each other («Основная
 *   информация» and «Дополнительная информация» share rows), units are
 *   English identifiers (`Millimeters`, `Grands`) and some yes/no values are
 *   `True` / `False`.
 */

export const B2BIT_BASE_URL = 'https://b2bit.by';
export const B2BIT_API_URL = 'https://api.b2bit.by/api/v1';

/**
 * b2bit departments whose name is dropped from our category branch. Their
 * children («Электроинструмент», «Ручной инструмент», «Крепёж, метизы»…) are
 * departments of our own catalogue already, so the branch starts there and
 * `upsertBranch()` lands the products in the existing roots instead of a
 * parallel «Стройка и ремонт» tree. The supplier-side `SourceCategory` keeps
 * the full chain.
 */
const FLATTENED_ROOTS = new Set(['стройка и ремонт']);

/* ------------------------------------------------------------ API types ---- */

export type B2bitCategoryNode = {
  id: number;
  name: string;
  parent_id?: number | null;
  /** Products with a live offer in this branch. */
  count?: number;
  subcategories?: B2bitCategoryNode[];
};

export type B2bitOffer = {
  ext_id?: string;
  company?: string;
  sku?: string;
  quantity?: number;
  status?: string;
  available?: boolean;
  promotion?: string;
  price?: number | null;
  price_old?: number | null;
  price_rrc?: number | null;
  currency?: string;
  warranty?: number | null;
};

type B2bitProperty = {
  id?: number;
  property_id?: number;
  name?: string;
  value?: string | null;
  unit?: string | null;
};

export type B2bitProduct = {
  id: number;
  name?: string;
  sku?: string | null;
  ean?: string | null;
  vendor?: { id?: number; name?: string | null } | null;
  category?: { id?: number; name?: string } | null;
  photos?: string[] | null;
  properties?: Array<{ name?: string; value?: B2bitProperty[] }> | null;
  offers?: B2bitOffer[] | null;
};

export type B2bitListing = {
  count?: number;
  products?: Array<{ id: number; offers?: B2bitOffer[] }>;
};

/* ---------------------------------------------------------------- URLs ---- */

/** The offer URL (queue row, `SourceProduct.url`): the portal's product page. */
export function b2bitProductUrl(id: number | string) {
  return `${B2BIT_BASE_URL}/product/${id}`;
}

/**
 * The product id of a portal or API product URL, or undefined for anything
 * else. Accepts `https://b2bit.by/product/123?r=search` and the API's
 * `https://api.b2bit.by/api/v1/product/123`.
 */
export function b2bitProductId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, B2BIT_BASE_URL);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'b2bit.by' && !host.endsWith('.b2bit.by')) return undefined;
  const match = /^(?:\/api\/v1)?\/product\/(\d+)\/?$/.exec(parsed.pathname);
  return match?.[1];
}

/**
 * One page of a category listing — only products with a live offer
 * (`unavailable=false`), the set the price list holds. Without the four stock
 * flags the API answers 500.
 */
export function b2bitListingUrl(
  categoryId: number,
  page: number,
  pageSize: number,
) {
  const params = new URLSearchParams({
    stock: 'true',
    reserve: 'true',
    under_order: 'true',
    transit: 'true',
    unavailable: 'false',
    sort_by: 'default',
    page: String(page),
    page_size: String(pageSize),
    with_count: '1',
  });
  return `${B2BIT_API_URL}/category/${categoryId}/products?${params}`;
}

/* ---------------------------------------------------------- categories ---- */

export type B2bitLeaf = { id: number; path: string[]; count: number };

/** id → names from the root, for every node of the tree. */
export function b2bitCategoryPaths(tree: B2bitCategoryNode[]) {
  const paths = new Map<number, string[]>();
  const walk = (nodes: B2bitCategoryNode[] | undefined, parent: string[]) => {
    for (const node of nodes ?? []) {
      const path = [...parent, clean(node.name)];
      paths.set(node.id, path);
      walk(node.subcategories, path);
    }
  };
  walk(tree, []);
  return paths;
}

/** Leaf categories (the ones that list products), with their full path. */
export function b2bitLeafCategories(tree: B2bitCategoryNode[]): B2bitLeaf[] {
  const leaves: B2bitLeaf[] = [];
  const walk = (nodes: B2bitCategoryNode[] | undefined, parent: string[]) => {
    for (const node of nodes ?? []) {
      const path = [...parent, clean(node.name)];
      if (node.subcategories?.length) walk(node.subcategories, path);
      else leaves.push({ id: node.id, path, count: node.count ?? 0 });
    }
  };
  walk(tree, []);
  return leaves;
}

/** Our catalogue branch for a b2bit breadcrumb chain — see FLATTENED_ROOTS. */
export function b2bitCatalogBranch(breadcrumbs: string[]) {
  const [root, ...rest] = breadcrumbs;
  return root && rest.length && FLATTENED_ROOTS.has(root.toLowerCase())
    ? rest
    : breadcrumbs;
}

/** Product ids of a listing page, in listing order, without duplicates. */
export function b2bitListingIds(listing: B2bitListing): number[] {
  return [
    ...new Set(
      (listing.products ?? [])
        .map((product) => product.id)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

/* -------------------------------------------------------------- offers ---- */

/**
 * The offer that speaks for the product. Today every product has exactly one
 * (one distributor, one warehouse); should a second appear, one that can be
 * bought wins, then the cheaper price for us.
 */
export function pickB2bitOffer(
  offers: B2bitOffer[] | null | undefined,
): B2bitOffer | undefined {
  return [...(offers ?? [])].sort(
    (a, b) =>
      Number(b.available === true) - Number(a.available === true) ||
      (sellingPrice(a) ?? Infinity) - (sellingPrice(b) ?? Infinity),
  )[0];
}

/**
 * Our selling price of an offer: the struck-through `price_old`. Undefined
 * when there is none, or when it is under the purchase price — that would be
 * a sale at a loss, so it is treated as no price rather than trusted.
 */
export function sellingPrice(offer: B2bitOffer | undefined) {
  const old = positive(offer?.price_old);
  if (old === undefined) return undefined;
  const purchase = positive(offer?.price);
  if (purchase !== undefined && old < purchase) return undefined;
  return old;
}

/* -------------------------------------------------------------- product ---- */

export type ParsedB2bitProduct = {
  productId: string;
  name: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  /** b2bit category id; its path comes from the tree, see `breadcrumbs`. */
  categoryId?: number;
  /** Full b2bit chain from the root, empty when the tree does not know it. */
  breadcrumbs: string[];
  images: string[];
  specifications: { name: string; value: string }[];
  /** Has an offer at all (the portal still lists it). */
  hasOffer: boolean;
  /** An offer that can be bought now. */
  inStock: boolean;
  /** Our selling price — the struck-through one; see the module note. */
  price?: number;
  /** Admin-only reference numbers; never on the storefront. */
  purchasePrice?: number;
  rrp?: number;
  quantity?: number;
  promotion?: string;
  supplierCode?: string;
  warrantyMonths?: number;
};

export function parseB2bitProduct(
  product: B2bitProduct,
  categoryPaths: Map<number, string[]>,
): ParsedB2bitProduct {
  const offer = pickB2bitOffer(product.offers);
  const categoryId = product.category?.id;
  const breadcrumbs =
    (categoryId !== undefined ? categoryPaths.get(categoryId) : undefined) ??
    [];

  return {
    productId: String(product.id),
    name: clean(product.name ?? ''),
    sku: optional(product.sku),
    barcode: barcode(product.ean),
    brand: optional(product.vendor?.name),
    categoryId,
    breadcrumbs,
    images: images(product.photos),
    specifications: b2bitSpecifications(product.properties),
    hasOffer: Boolean(offer),
    inStock: offer?.available === true,
    price: sellingPrice(offer),
    purchasePrice: positive(offer?.price),
    rrp: positive(offer?.price_rrc),
    quantity:
      typeof offer?.quantity === 'number' && offer.quantity >= 0
        ? offer.quantity
        : undefined,
    promotion: optional(offer?.promotion),
    supplierCode: optional(offer?.sku),
    warrantyMonths: positive(offer?.warranty),
  };
}

/* ------------------------------------------------------- specifications ---- */

/**
 * b2bit unit identifiers → how our catalogue spells them. The unit goes into
 * the characteristic's *name* («Мощность, Вт» = «2500») — that is the form
 * `canonicalSpec()` lifts the unit from, so the filter lines up with the same
 * characteristic from the other suppliers. Collected from one product of
 * every «Стройка и ремонт» leaf category (2026-11-17). An unknown identifier
 * is dropped rather than printed in English.
 */
const UNITS: Record<string, string> = {
  Micrometers: 'мкм',
  Millimeters: 'мм',
  Centimeters: 'см',
  Meters: 'м',
  Grams: 'г',
  Kilograms: 'кг',
  Tons: 'т',
  Volts: 'В',
  Watts: 'Вт',
  Kilowatts: 'кВт',
  AmpereHours: 'А·ч',
  Hertz: 'Гц',
  RotationsPerMinute: 'об/мин',
  BeatsPerMinute: 'уд/мин',
  MovesPerMinute: 'ход/мин',
  MetersPerMinute: 'м/мин',
  Liters: 'л',
  Milliliters: 'мл',
  LitersPerMinute: 'л/мин',
  MillilitersPerMinute: 'мл/мин',
  GramsPerMinute: 'г/мин',
  CubicMetersPerHour: 'м³/ч',
  NewtonMeters: 'Н·м',
  Joules: 'Дж',
  Bars: 'бар',
  DegreeCelsius: '°C',
  AngleDegrees: '°',
  Decibels: 'дБ',
  Minutes: 'мин',
  Hours: 'ч',
  Grands: 'шт',
  DimensionlessQuantity: '',
};

/**
 * Every characteristic once, in the order the portal shows them. Groups
 * repeat rows, so a row is identified by its `property_id` (the country row
 * has none — by name). Empty values (`null`, `''`) are the portal's unfilled
 * template fields and are skipped; the first non-empty spelling of a name wins.
 */
export function b2bitSpecifications(
  groups: B2bitProduct['properties'],
): { name: string; value: string }[] {
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();
  const specs: { name: string; value: string }[] = [];

  for (const group of groups ?? []) {
    for (const row of group.value ?? []) {
      if (row.property_id !== undefined) {
        if (seenIds.has(row.property_id)) continue;
      }
      const value = specValue(row.value);
      const name = specName(row.name, row.unit);
      if (!value || !name) continue;
      if (seenNames.has(name.toLowerCase())) continue;
      if (row.property_id !== undefined) seenIds.add(row.property_id);
      seenNames.add(name.toLowerCase());
      specs.push({ name, value });
    }
  }
  return specs;
}

function specName(name: string | undefined, unit: string | null | undefined) {
  const base = clean(name ?? '');
  if (!base) return '';
  const rendered = unit ? UNITS[unit] : undefined;
  if (!rendered) return base;
  // «Вес, кг» or «Мощность (Вт)» already says it.
  const tail = base.toLowerCase();
  if (
    tail.endsWith(`, ${rendered.toLowerCase()}`) ||
    tail.endsWith(`(${rendered.toLowerCase()})`)
  ) {
    return base;
  }
  return `${base}, ${rendered}`;
}

function specValue(value: string | null | undefined) {
  const text = clean(value ?? '');
  if (!text) return '';
  if (/^true$/i.test(text)) return 'да';
  if (/^false$/i.test(text)) return 'нет';
  // «2500.0» → «2500»: the API prints whole numbers as floats.
  if (/^-?\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  return text;
}

/* ---------------------------------------------------------------- utils ---- */

function images(photos: string[] | null | undefined) {
  const urls: string[] = [];
  for (const photo of photos ?? []) {
    const url = photo?.trim();
    if (!url || !/^https?:\/\//i.test(url) || urls.includes(url)) continue;
    urls.push(url);
  }
  return urls;
}

/** A GTIN of 8–14 digits; the portal sometimes leaves the field empty. */
function barcode(value: string | null | undefined) {
  const digits = value?.trim() ?? '';
  return /^\d{8,14}$/.test(digits) ? digits : undefined;
}

function positive(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function optional(value: string | null | undefined) {
  const text = clean(value ?? '');
  return text || undefined;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
