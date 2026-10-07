import * as cheerio from 'cheerio';

const TOOLS_BASE_URL = 'https://tools.by';

export type ParsedToolsProduct = {
  /** False for a category/landing page that happened to land in the queue. */
  isProductPage: boolean;
  /** tools.by's own id, from the h1. Everything else is scoped by it. */
  productId?: string;
  name: string;
  sku?: string;
  /**
   * From the "Штрихкод" spec row. Worth keeping even though it is buried in the
   * spec table: barcode is the only signal besides brand+sku that auto-merges a
   * tools.by offer with the same product from another supplier.
   */
  barcode?: string;
  brand?: string;
  price?: number;
  inStock?: boolean;
  images: string[];
  description?: string;
  breadcrumbs: string[];
  specifications: { name: string; value: string }[];
};

type JsonLdProduct = {
  '@type'?: string;
  name?: string;
  brand?: { name?: string };
  offers?: { price?: string; priceCurrency?: string; availability?: string };
};

/**
 * tools.by product page.
 *
 * The one rule that matters here: **a product page embeds many other products**
 * (recommendation carousels, "похожие товары"), each with its own price block
 * and gallery. So price and images are scoped to the main product — by
 * `data-product-id` from the h1, and by the `.product__carousel` container.
 * Taking "the first price on the page" works only by accident of DOM order and
 * would silently put a recommended item's price on our card.
 */
export function parseTools(html: string): ParsedToolsProduct {
  const $ = cheerio.load(html);

  const title = $('h1.product__title').first();
  const productId = title.attr('data-product-id') || undefined;

  // The h1 carries a parenthetical clarification in a nested span; it belongs in
  // the description, not in the product name.
  const shortDescription = clean(title.find('.short-description').text());
  const heading = title.clone();
  heading.find('.short-description').remove();
  const name = clean(heading.text());

  const jsonLd = parseJsonLdProduct($);
  const specifications = parseSpecs($);

  return {
    isProductPage: Boolean(productId && name),
    productId,
    name: name || clean(jsonLd?.name ?? ''),
    sku: clean($('#product_artikul').first().text()) || undefined,
    barcode: findSpecValue(specifications, ['штрихкод', 'ean', 'gtin']),
    brand: clean(jsonLd?.brand?.name ?? '') || undefined,
    price: parseMainPrice($, productId),
    inStock: parseAvailability(jsonLd),
    images: parseImages($),
    description: shortDescription || undefined,
    breadcrumbs: parseBreadcrumbs($),
    specifications,
  };
}

function findSpecValue(
  specs: { name: string; value: string }[],
  keys: string[],
) {
  const found = specs.find((spec) =>
    keys.some((key) => spec.name.toLowerCase().includes(key)),
  );
  return found?.value;
}

/**
 * The price block belonging to *this* product. JSON-LD is useless here — the
 * shop publishes `"price": "0.00"` in it — so the value comes from the
 * `data-price` attribute of the block whose `data-product-id` matches the h1.
 */
function parseMainPrice($: cheerio.CheerioAPI, productId?: string) {
  if (!productId) return undefined;

  const block = $(
    `.js-markup-price[data-product-id="${cssEscape(productId)}"]`,
  ).first();

  return parseNumber(block.attr('data-price') ?? '');
}

function parseAvailability(jsonLd?: JsonLdProduct) {
  const availability = jsonLd?.offers?.availability;
  if (!availability) return undefined;
  return /InStock/i.test(availability);
}

/**
 * Gallery images, largest variant first. Every photo is served at several sizes
 * (`-1200x900`, `-640x480`, `-160x120`) off content.tools.by, so they are
 * deduplicated by the size-stripped URL — otherwise one photo becomes three.
 */
function parseImages($: cheerio.CheerioAPI) {
  const byKey = new Map<string, string>();

  $('.product__carousel')
    .find('img, [data-izoomify-url]')
    .each((_, element) => {
      const node = $(element);
      // data-izoomify-url is the zoom source: the largest variant on the page.
      const src = node.attr('data-izoomify-url') || node.attr('src');
      if (!src || !isProductImage(src)) return;

      const url = absoluteUrl(src);
      const key = url.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      const existing = byKey.get(key);
      if (!existing || sizeScore(url) > sizeScore(existing)) {
        byKey.set(key, url);
      }
    });

  return [...byKey.values()].slice(0, 12);
}

/** Width from the `-1200x900` suffix, so the biggest variant wins. */
function sizeScore(url: string) {
  const match = url.match(/-(\d+)x\d+\.[a-z]+$/i);
  return match ? Number(match[1]) : 0;
}

/**
 * Category chain. The trailing crumb is a brand filter
 * (`/catalog/…?brand_id[0]=361`) and the first is a "← Назад" button — both
 * would otherwise become categories.
 */
function parseBreadcrumbs($: cheerio.CheerioAPI) {
  const names: string[] = [];

  $('.breadcrumb-item a[href*="/catalog/"]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    if (href.includes('?')) return;

    const name = clean($(element).text());
    if (name) names.push(name);
  });

  return names;
}

function parseSpecs($: cheerio.CheerioAPI) {
  const specs = new Map<string, string>();

  // "Характеристики" — dt/dd pairs wrapped in a div per row.
  $('.product__technical-characteristics .detail-specs').each((_, element) => {
    $(element)
      .find('dt')
      .each((__, dt) => {
        addSpec(specs, $(dt).text(), $(dt).next('dd').text());
      });
  });

  // The description tab carries a key/value table (Производитель, Гарантия, …).
  $('.product__description table tr').each((_, element) => {
    addSpec(
      specs,
      $(element).find('.item-key').first().text(),
      $(element).find('.item-value').first().text(),
    );
  });

  return [...specs.entries()].map(([name, value]) => ({ name, value }));
}

function parseJsonLdProduct($: cheerio.CheerioAPI): JsonLdProduct | undefined {
  let found: JsonLdProduct | undefined;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (found) return;
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      found = candidates.find(
        (item): item is JsonLdProduct =>
          typeof item === 'object' &&
          item !== null &&
          (item as JsonLdProduct)['@type'] === 'Product',
      );
    } catch {
      // Malformed JSON-LD is not a reason to lose the whole product.
    }
  });

  return found;
}

function addSpec(specs: Map<string, string>, name: string, value: string) {
  const cleanName = clean(name).replace(/:$/, '');
  const cleanValue = clean(value);
  if (cleanName && cleanValue) specs.set(cleanName, cleanValue);
}

function parseNumber(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;

  const price = Number.parseFloat(match[0]);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function isProductImage(url: string) {
  const normalized = url.toLowerCase();
  return (
    !normalized.startsWith('data:') &&
    !normalized.includes('no_photo') &&
    !normalized.includes('/assets/images/') &&
    !normalized.includes('/logos/') &&
    !normalized.includes('favicon') &&
    /\.(jpe?g|png|webp)(?:\?|$)/.test(normalized)
  );
}

/** Attribute selectors break on unescaped values; ids here are numeric. */
function cssEscape(value: string) {
  return value.replace(/["\\]/g, '');
}

function absoluteUrl(url: string) {
  if (url.startsWith('http')) return url;
  return `${TOOLS_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
