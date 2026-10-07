import * as cheerio from 'cheerio';
import { TParsedProduct } from '../types/parsed-product.type';

const TH_TOOLS_BASE_URL = 'https://th-tool.by';

/**
 * Breadcrumb roots that are navigation, not taxonomy. Without this the whole
 * supplier tree ends up hanging under a category literally named "Главная".
 */
const BREADCRUMB_NOISE = new Set(['главная', 'каталог']);

export type ParsedThToolsProduct = TParsedProduct & {
  sku?: string;
  model?: string;
  brand?: string;
  barcode?: string;
  /** Category chain without the site root and without the product itself. */
  breadcrumbs: string[];
  /** `undefined` when the page carries no availability markup at all. */
  inStock?: boolean;
  isProductPage: boolean;
};

/**
 * Pure HTML → data for th-tool.by (Webasyst shop). No DB access, so it is
 * unit-tested against `fixtures/th-tools-product.html`, which is a trimmed
 * copy of a real product page.
 */
export function parseThTools(html: string): ParsedThToolsProduct {
  const $ = cheerio.load(html);

  const name = clean(
    $('h1').first().text() ||
      parseMeta($, 'og:title') ||
      $('title').first().text(),
  );

  const specifications = parseSpecs($);
  const breadcrumbs = parseBreadcrumbs($);

  return {
    name,
    price: parsePrice($),
    images: parseImages($),
    description: parseDescription($),
    specifications,
    sku: parseSku($, specifications),
    model: findSpecValue(specifications, ['модель']),
    brand: parseBrand($, specifications, breadcrumbs),
    barcode: findSpecValue(specifications, ['штрихкод', 'ean', 'gtin']),
    breadcrumbs,
    inStock: parseAvailability($),
    isProductPage: isProductPage($),
  };
}

function parseBreadcrumbs($: cheerio.CheerioAPI) {
  return $('.bread__link')
    .not('.bread__link_last')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((name) => name && !BREADCRUMB_NOISE.has(name.toLowerCase()));
}

/**
 * `<meta itemprop="price" content="34.37">` is the machine-readable value;
 * the visible ".price" text is localised ("34,37 р.") and only a fallback.
 */
function parsePrice($: cheerio.CheerioAPI) {
  return (
    toNumber($('[itemprop="price"]').first().attr('content')) ??
    toNumber($('[itemprop="price"]').first().text()) ??
    toNumber($('.price.product__price').first().text())
  );
}

/**
 * schema.org availability, e.g. `<link itemprop="availability"
 * href="http://schema.org/InStock">`. Returns undefined when the page says
 * nothing, so the caller can tell "out of stock" from "unknown".
 */
function parseAvailability($: cheerio.CheerioAPI) {
  const node = $('[itemprop="availability"]').first();
  if (!node.length) return undefined;

  const value = (
    node.attr('href') ||
    node.attr('content') ||
    node.text() ||
    ''
  ).toLowerCase();
  if (!value) return undefined;
  if (value.includes('outofstock') || value.includes('soldout')) return false;
  if (value.includes('instock') || value.includes('limitedavailability')) {
    return true;
  }
  return undefined;
}

function parseSku(
  $: cheerio.CheerioAPI,
  specs: { name: string; value: string }[],
) {
  return (
    clean(
      $('.product__code span').first().text() ||
        $('[itemprop="sku"]').first().attr('content') ||
        $('[itemprop="sku"]').first().text(),
    ) ||
    // "Код" is deliberately not a needle: on th-tool.by it is an internal
    // numeric id ("49053"), not the supplier article ("F-617E0813").
    findSpecValue(specs, ['артикул', 'код товара', 'sku']) ||
    undefined
  );
}

function parseBrand(
  $: cheerio.CheerioAPI,
  specs: { name: string; value: string }[],
  breadcrumbs: string[],
) {
  const brand =
    clean(
      $('.product__top-brand-name, .product__brand a, .brand a').first().text(),
    ) ||
    // Not "поставщик": that column holds the factory ("Sichuan"), and a wrong
    // brand poisons the brand+sku duplicate matching.
    findSpecValue(specs, ['бренд', 'торговая марка', 'производитель']);

  if (!brand || isCategoryEcho(brand, breadcrumbs)) return undefined;
  return brand;
}

/**
 * Some products carry their own category as the "brand" — the hydraulics spare
 * parts sit in `… / Запчасти` and claim the brand "запчасти". A brand that is
 * literally one of the breadcrumbs is not a brand, and letting it through would
 * both create junk brand pages and corrupt brand+sku duplicate matching.
 * Genuine names that merely start with the word ("Запчасти Rotake") survive,
 * because the check is an exact match.
 */
function isCategoryEcho(brand: string, breadcrumbs: string[]) {
  const normalized = brand.toLowerCase();
  return breadcrumbs.some((crumb) => crumb.toLowerCase() === normalized);
}

function parseDescription($: cheerio.CheerioAPI) {
  return (
    clean(
      $('.desc.desc_max, .product__description').first().text() ||
        $('[itemprop="description"]').first().text(),
    ) || parseMeta($, 'description')
  );
}

function parseSpecs($: cheerio.CheerioAPI) {
  const specs = new Map<string, string>();

  $('.features-two-val__block').each((_, block) => {
    addSpec(
      specs,
      $(block).find('.features-two-val__name span').text(),
      $(block).find('.features-two-val__value').text(),
    );
  });

  $('.characteristics tr, .product__specifications tr').each((_, row) => {
    addSpec(
      specs,
      $(row).find('th, td').first().text(),
      $(row).find('td').last().text(),
    );
  });

  return [...specs.entries()].map(([name, value]) => ({ name, value }));
}

/**
 * The gallery exposes every photo at several sizes — `<a href="…970.webp">`
 * around an `<img data-src="…0x600.webp">`, plus `og:image` at `750x0`.
 * Collecting them naively stored one product photo three times, so images are
 * keyed by the size-stripped URL and the first (largest, gallery-ordered)
 * variant wins.
 */
function parseImages($: cheerio.CheerioAPI) {
  const byKey = new Map<string, string>();

  const add = (src?: string | null) => {
    if (!src || !isProductImage(src)) return;
    const url = absoluteUrl(src);
    const key = sizelessKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  };

  // Gallery links first: they carry the largest variant and the display order.
  $('.p-images__slider-item').each((_, el) => add($(el).attr('href')));
  $('.p-images img, .p-images__slider-item img').each((_, el) =>
    add($(el).attr('data-src') || $(el).attr('src')),
  );
  $('meta[property="og:image"]').each((_, el) => add($(el).attr('content')));

  return [...byKey.values()];
}

/** `…/6889614.970.webp` and `…/6889614.0x600.webp` are the same photo. */
function sizelessKey(url: string) {
  return url.replace(
    /\.(?:\d+x\d+|\d+x|x\d+|\d+)\.(jpe?g|png|webp)(\?.*)?$/i,
    '.$1',
  );
}

function isProductPage($: cheerio.CheerioAPI) {
  if ($('h1.category-name').length) return false;
  return Boolean(
    $('.product__code span, [itemprop="sku"]').length ||
    $('.features-two-val__block').length ||
    $('.p-images__slider-item').length,
  );
}

export function findSpecValue(
  specs: { name: string; value: string }[],
  needles: string[],
) {
  return specs.find((spec) =>
    needles.some((needle) => spec.name.toLowerCase().includes(needle)),
  )?.value;
}

function addSpec(specs: Map<string, string>, name: string, value: string) {
  const cleanName = clean(name).replace(/:$/, '');
  const cleanValue = clean(value);
  if (cleanName && cleanValue) specs.set(cleanName, cleanValue);
}

function parseMeta($: cheerio.CheerioAPI, name: string) {
  return clean(
    $(`meta[name="${name}"], meta[property="${name}"]`)
      .first()
      .attr('content') || '',
  );
}

function toNumber(value?: string) {
  if (!value) return undefined;
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isProductImage(url: string) {
  const normalized = url.toLowerCase();
  return (
    !normalized.startsWith('data:') &&
    !normalized.includes('no_photo') &&
    !normalized.includes('favicon') &&
    !normalized.includes('sprite') &&
    // Photo-less products still render a gallery, filled with the theme's
    // `/themes/<name>/img/default.png`. Storing it would give the product a
    // fake picture and hide it from the "без фото" data-quality report.
    !normalized.includes('/themes/') &&
    !/\/default\.(png|jpe?g|webp)/.test(normalized) &&
    /\.(jpe?g|png|webp)(?:\?|$)/.test(normalized)
  );
}

function absoluteUrl(url: string) {
  if (url.startsWith('http')) return url;
  return `${TH_TOOLS_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function clean(value?: string) {
  return (value || '').replace(/\s+/g, ' ').trim();
}
