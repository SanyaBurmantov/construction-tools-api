/**
 * Pure HTML → data functions for dukon.by: product pages, JSON-LD, catalogue
 * listings. No database and no Nest, so they are tested against fixtures —
 * the same split as `th-tools.parser.ts` / `tools.parser.ts` next to their
 * services. They used to be ~35 private methods inside a 1400-line service.
 */
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { sanitizeSupplierText, truncateAtWord } from '../supplier-text';

export type DukonStockStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'preorder'
  | 'unknown';
type JsonRecord = Record<string, unknown>;

export type ParsedJsonLdProduct = {
  name?: string;
  description?: string;
  sku?: string;
  mpn?: string;
  barcode?: string;
  brand?: string;
  images: string[];
  price?: number;
  currency?: string;
  availability?: string;
  raw?: JsonRecord;
};

export const DUKON_BASE_URL = 'https://dukon.by';
/** The supplier's own brand index. Each brand page lists all of its products. */
export const DUKON_BRANDS_URL = `${DUKON_BASE_URL}/brands/`;

export type DukonPageKind = 'catalog' | 'brand-index' | 'brand';

/**
 * Dukon's catalogue and brand pages share a domain but not a layout: the
 * catalogue has 24 cards/page, a brand page 15, and its pagination is
 * `PAGEN_2` where the catalogue uses `PAGEN_1`. The crawl therefore has to
 * know which kind of page it is looking at.
 */
export function dukonPageKind(url: string): DukonPageKind {
  const pathname = new URL(absoluteUrl(url)).pathname;
  if (pathname === '/brands' || pathname === '/brands/') return 'brand-index';
  if (pathname.startsWith('/brands/')) return 'brand';
  return 'catalog';
}

/** Longer than this and the "brand" is an address or a description. */
const MAX_BRAND_LENGTH = 40;

/**
 * Legal-entity and address markers. dukon's "Производитель" field frequently
 * holds the manufacturer's company record rather than the brand.
 */
// `\b` is ASCII-only in JavaScript, so it never matches before а Cyrillic
// letter — the address markers need an explicit start-or-separator instead.
const LEGAL_ENTITY =
  /(^|[\s"«(,])(ООО|ОАО|ЗАО|ОДО|ЧУП|УП|ИП|ПАО|АО|GmbH|LLC|Ltd|Inc)([\s".,»)]|$)|(^|[\s,])(г|ул|пер|пр-т|просп|д|оф|корп)\./i;

export function parseSitemapUrls(xml: string) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as {
    urlset?: { url?: Array<{ loc?: string }> | { loc?: string } };
  };
  const entries = Array.isArray(parsed.urlset?.url)
    ? parsed.urlset.url
    : parsed.urlset?.url
      ? [parsed.urlset.url]
      : [];

  return entries
    .map((entry) => entry.loc)
    .filter((url): url is string => Boolean(url?.includes('/catalog/')))
    .map((url) => absoluteUrl(url));
}

export function parseCurrentCategoryNames($: cheerio.CheerioAPI) {
  const names = $('.rsbreadcrumb [itemprop="name"]')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((name) => name && name !== 'Главная' && name !== 'Каталог');
  const currentName = clean($('h1').first().text());

  if (
    currentName &&
    !['главная', 'каталог'].includes(currentName.toLowerCase()) &&
    names[names.length - 1] !== currentName
  ) {
    names.push(currentName);
  }

  return names;
}

export function parseChildCategoryLinks($: cheerio.CheerioAPI) {
  const categories = new Map<string, { name: string; url: string }>();

  $('a.parent, a.psection').each((_, el) => {
    const href = $(el).attr('href');
    const url = href ? absoluteUrl(href) : undefined;
    const name = clean(
      $(el).text() ||
        $(el).attr('title') ||
        $(el).find('img').attr('alt') ||
        '',
    );

    if (url && name && isCatalogUrl(url) && !hasPagination(url)) {
      categories.set(url, { name, url });
    }
  });

  return [...categories.values()];
}

export function parseCatalogProductUrls($: cheerio.CheerioAPI) {
  const urls = new Set<string>();

  // Brand pages (and the brand index) use `js-element[data-detail]` cards
  // instead of the catalogue's `.prod-list__item`. Taking every `data-detail`
  // that points into `/catalog/` covers both layouts; brand links are filtered
  // out by `isCatalogUrl`.
  $('[data-detail]').each((_, el) => {
    const detailUrl = $(el).attr('data-detail');
    if (!detailUrl) return;
    const url = absoluteUrl(detailUrl);
    if (isCatalogUrl(url)) urls.add(url);
  });

  $('.prod-list__item').each((_, el) => {
    const detailUrl = $(el).attr('data-detail');
    if (detailUrl) {
      const url = absoluteUrl(detailUrl);
      if (isCatalogUrl(url)) urls.add(url);
    }

    $(el)
      .find('a.prod-name, .prod-preview a')
      .each((__, link) => {
        const href = $(link).attr('href');
        if (!href) return;
        const url = absoluteUrl(href);
        if (isCatalogUrl(url)) urls.add(url);
      });
  });

  return [...urls];
}

export function parseCatalogCategoryUrls(
  $: cheerio.CheerioAPI,
  rootUrl: string,
) {
  const urls = new Set<string>();

  $('a.parent, a.psection, .catmenu a, .catalogmenu a').each((_, el) => {
    const href = $(el).attr('href');
    const url = href ? absoluteUrl(href) : undefined;
    if (
      url &&
      isCatalogUrl(url) &&
      !hasPagination(url) &&
      isInsideCatalogBranch(url, rootUrl)
    ) {
      urls.add(url);
    }
  });

  return [...urls];
}

/** True only for pages on the supplier's own host, never a lookalike link. */
export function isDukonUrl(url: string) {
  try {
    const hostname = new URL(absoluteUrl(url)).hostname;
    return hostname === 'dukon.by' || hostname === 'www.dukon.by';
  } catch {
    return false;
  }
}

/** Brand links on the `/brands/` index: `/brands/<slug>/`, never pagination. */
export function parseBrandLinks($: cheerio.CheerioAPI) {
  const urls = new Set<string>();
  const add = (href: string | undefined) => {
    if (!href) return;
    const url = new URL(absoluteUrl(href));
    if (!isDukonUrl(url.toString())) return;
    const slug = url.pathname.replace(/^\/brands\//, '').replace(/\/$/, '');
    if (!url.pathname.startsWith('/brands/') || !slug || slug.includes('/')) {
      return;
    }
    url.protocol = 'https:';
    url.hostname = 'dukon.by';
    url.search = '';
    url.hash = '';
    urls.add(url.toString());
  };

  $('a[href*="/brands/"], [data-detail*="/brands/"]').each((_, el) =>
    add($(el).attr('href') || $(el).attr('data-detail')),
  );

  return [...urls];
}

/** Dukon numbers catalogue pages with `PAGEN_1` and brand pages with `PAGEN_2`. */
export function parsePaginationParam(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): 'PAGEN_1' | 'PAGEN_2' {
  const href = $('#paginator a[href*="PAGEN_"]').first().attr('href');
  if (href && isDukonUrl(href)) {
    if (href.includes('PAGEN_2=')) return 'PAGEN_2';
    if (href.includes('PAGEN_1=')) return 'PAGEN_1';
  }
  return dukonPageKind(pageUrl) === 'catalog' ? 'PAGEN_1' : 'PAGEN_2';
}

/**
 * Page count for listings without `data-navpagecount` (the brand index).
 * The paginator links only the first few and last pages, so take the highest
 * linked page as a floor and, on page 1, also compute the count from the
 * "1 - 20 из 141" summary. The summary is only trustworthy on page 1: on the
 * last page it reads "141 - 141 из 141", which would imply 141 pages.
 */
function parsePaginatorPageCount($: cheerio.CheerioAPI) {
  let linkedMax = 0;
  $('#paginator a[href*="PAGEN_"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !isDukonUrl(href)) return;
    const match = href.match(/PAGEN_\d+=(\d+)/);
    if (match) linkedMax = Math.max(linkedMax, Number(match[1]));
  });

  const match = clean($('#paginator').text()).match(
    /(\d+)\s*-\s*(\d+)\s+из\s+(\d+)/,
  );
  if (!match || match[1] !== '1') return linkedMax;

  const perPage = Number(match[2]);
  const total = Number(match[3]);
  if (perPage <= 0 || !Number.isFinite(total)) return linkedMax;
  return Math.max(linkedMax, Math.ceil(total / perPage));
}

export function parseCatalogPaginationUrls(
  $: cheerio.CheerioAPI,
  pageUrl: string,
) {
  if (!isDukonUrl(pageUrl)) return [];
  const urls = new Set<string>();
  const param = parsePaginationParam($, pageUrl);
  let pageCount = Number(
    $('.ajaxpages [data-navpagecount]').first().attr('data-navpagecount'),
  );
  if (!Number.isFinite(pageCount) || pageCount <= 1) {
    pageCount = parsePaginatorPageCount($);
  }

  // Only the first page needs every page number generated. O(n²) rebuilding
  // on page 2…n just produced the same URLs over and over; those pages carry
  // links to their neighbours and the last page in the paginator.
  const currentPage = new URL(pageUrl).searchParams.get(param);
  if (
    (!currentPage || currentPage === '1') &&
    Number.isFinite(pageCount) &&
    pageCount > 1
  ) {
    for (let page = 2; page <= pageCount; page += 1) {
      urls.add(withPageNumber(pageUrl, page, param));
    }
  }

  $('#paginator a[href*="PAGEN_"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const url = absoluteUrl(href);
    if (isDukonUrl(url)) urls.add(url);
  });

  return [...urls];
}

export function isCatalogUrl(url: string) {
  if (!isDukonUrl(url)) return false;
  return new URL(absoluteUrl(url)).pathname.startsWith('/catalog/');
}

export function isInsideCatalogBranch(url: string, rootUrl: string) {
  const parsedUrl = new URL(url);
  const parsedRoot = new URL(rootUrl);
  return parsedUrl.pathname.startsWith(parsedRoot.pathname);
}

export function hasPagination(url: string) {
  return /PAGEN_\d+=/.test(url);
}

export function withPageNumber(
  url: string,
  page: number,
  param: 'PAGEN_1' | 'PAGEN_2' = 'PAGEN_1',
) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^PAGEN_\d+$/.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.set(param, String(page));
  return parsed.toString();
}

export function parseSpecs($: cheerio.CheerioAPI) {
  return $('#properties .groupedprops.table .table__item')
    .map((_, el) => ({
      name: clean($(el).find('.name').first().text()),
      value: clean($(el).find('.val').first().text()),
    }))
    .get()
    .filter((spec) => spec.name && spec.value);
}

export function isProductPage($: cheerio.CheerioAPI) {
  const hasDetails = Boolean(
    $('#properties .groupedprops.table .table__item').length ||
    $('.price.gen').length,
  );
  // Dukon marks some category pages as JSON-LD Products. A category listing
  // without its own details must not become a published product.
  if (!hasDetails && $('.prod-list__item').length) return false;
  return hasDetails || Boolean(parseJsonLdProduct($).name);
}

/**
 * Brand from the spec table, the JSON-LD, or the "Производитель:" line —
 * whichever first yields something that is actually a brand.
 *
 * dukon puts whatever the supplier typed under "Производитель", which is
 * often a legal entity ("ООО «Нордберг Руссия», г. Москва, ул. …") or the
 * product's own category. Either one is worse than no brand at all: an
 * article number only identifies a product *together with its brand*, so a
 * wrong brand silently merges two unrelated products under brand+sku, and
 * unpicking a bad merge is expensive. It also mints a junk brand page.
 */
export function resolveBrand(
  $: cheerio.CheerioAPI,
  specs: { name: string; value: string }[],
  jsonLdBrand: string | undefined,
  breadcrumbs: string[],
) {
  const candidates = [
    findBrandSpec(specs, 'производитель'),
    findBrandSpec(specs, 'бренд'),
    jsonLdBrand,
    parseBrand($),
  ];

  for (const candidate of candidates) {
    const brand = sanitizeBrand(candidate, breadcrumbs);
    if (brand) return brand;
  }
  return undefined;
}

/** Returns the brand, or undefined when the value is not one. */
export function sanitizeBrand(
  value: string | undefined,
  breadcrumbs: string[],
) {
  const brand = clean(value ?? '');
  if (!brand) return undefined;

  // A brand is a name, not a sentence. Anything this long is an address, a
  // description or a whole company record.
  if (brand.length > MAX_BRAND_LENGTH) return undefined;
  if (LEGAL_ENTITY.test(brand)) return undefined;

  // The product's own category echoed back as a brand. Exact match only, so
  // a genuine name that merely starts with the word survives.
  const normalized = brand.toLowerCase();
  if (breadcrumbs.some((crumb) => crumb.trim().toLowerCase() === normalized)) {
    return undefined;
  }

  return brand;
}

export function parseBrand($: cheerio.CheerioAPI) {
  const text = clean(
    $('.parameters-block__text, .prod-proplist__item')
      .filter((_, el) => clean($(el).text()).startsWith('Производитель:'))
      .first()
      .text(),
  );

  return text.replace(/^Производитель:\s*/, '') || undefined;
}

/**
 * A spec whose *name* is the word — «Производитель», «Производитель / бренд»,
 * «Бренд:» — not one that merely contains it. `findSpecValue`'s substring
 * match took «Производительность» (a compressor's air flow) for the maker:
 * dukon's compressors became brands «420 литров/мин», «1650/1400/1100 л/мин».
 */
export function findBrandSpec(
  specs: { name: string; value: string }[],
  word: string,
) {
  const pattern = new RegExp(`^${word}(?:$|[\\s/:,(])`, 'i');
  return specs.find((spec) => pattern.test(spec.name.trim()))?.value;
}

export function findSpecValue(
  specs: { name: string; value: string }[],
  needle: string,
) {
  return specs.find((spec) => spec.name.toLowerCase().includes(needle))?.value;
}

export function parseImages(
  $: cheerio.CheerioAPI,
  name: string,
  jsonLdImages: string[] = [],
) {
  const urls = new Set<string>();

  for (const image of jsonLdImages) {
    urls.add(absoluteUrl(image));
  }

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text()) as { image?: string | string[] };
      const images = Array.isArray(data.image) ? data.image : [data.image];
      for (const image of images) {
        if (image) urls.add(absoluteUrl(image));
      }
    } catch {
      // Ignore unrelated or invalid schema scripts.
    }
  });

  $(
    '.vertical-slider__el img, .pictures img.genimage, .fancy-slider__slide img.genimage, .bx_bigimages img',
  ).each((_, el) => {
    const src =
      $(el).attr('data-src') || $(el).attr('src') || $(el).attr('href');
    if (!src || !isProductImageUrl(src)) {
      return;
    }
    urls.add(absoluteUrl(src));
  });

  return [...urls].map((url, order) => ({ url, alt: name, order }));
}

export function parseJsonLdProduct($: cheerio.CheerioAPI): ParsedJsonLdProduct {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text()) as unknown;
      const product = findJsonLdProduct(parsed);
      if (!product) continue;

      const brandValue = product.brand;
      const offersValue = product.offers;
      const brand =
        readJsonLdString(asRecord(brandValue), 'name') ||
        (typeof brandValue === 'string' ? brandValue : undefined);
      const offers = Array.isArray(offersValue)
        ? (offersValue[0] as JsonRecord | undefined)
        : asRecord(offersValue);
      const imagesValue = product.image;
      const images = Array.isArray(imagesValue)
        ? imagesValue.filter(
            (image): image is string => typeof image === 'string',
          )
        : typeof imagesValue === 'string'
          ? [imagesValue]
          : [];
      const offerPrice = offers?.price;

      return {
        name: readJsonLdString(product, 'name'),
        description: readJsonLdString(product, 'description'),
        sku: readJsonLdString(product, 'sku'),
        mpn: readJsonLdString(product, 'mpn'),
        barcode:
          readJsonLdString(product, 'gtin13') ||
          readJsonLdString(product, 'gtin') ||
          readJsonLdString(product, 'gtin8'),
        brand,
        images,
        price: parsePrice(
          typeof offerPrice === 'string' || typeof offerPrice === 'number'
            ? String(offerPrice)
            : '',
        ),
        currency: readJsonLdString(offers, 'priceCurrency'),
        availability: readJsonLdString(offers, 'availability'),
        raw: product,
      };
    } catch {
      // Ignore unrelated or invalid schema scripts.
    }
  }

  return { images: [] };
}

export function findJsonLdProduct(value: unknown): JsonRecord | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const product = findJsonLdProduct(item);
      if (product) return product;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item).toLowerCase() === 'product')) {
    return record;
  }

  return findJsonLdProduct(record['@graph']);
}

export function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? (value as JsonRecord) : undefined;
}

export function readJsonLdString(
  record: JsonRecord | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? clean(value) : undefined;
}

export function isProductImageUrl(url: string) {
  const normalized = url.toLowerCase();
  return (
    normalized.includes('/upload/') &&
    normalized.includes('/iblock/') &&
    !normalized.includes('/resize_cache/') &&
    !normalized.includes('/local/templates/') &&
    !normalized.includes('/include/') &&
    !normalized.includes('sertifikat') &&
    !normalized.includes('certificate')
  );
}

export function parseDescription($: cheerio.CheerioAPI) {
  const text = clean(
    $('#detailtext, .detailtext, #description, .content.description')
      .first()
      .text(),
  );
  return sanitizeSupplierText(
    text.replace(/^Подробная информация\s*array\(0\) \{ \}\s*/, ''),
  );
}

export function parseDescriptionShort(
  $: cheerio.CheerioAPI,
  descriptionFull: string,
) {
  // dukon's meta description is a sales template with their phone and city
  // («…в Минске с гарантией и доставкой ☎ +375…»); see supplier-text.ts.
  const metaDescription = sanitizeSupplierText(parseMeta($, 'description'));
  if (metaDescription) return metaDescription;
  return descriptionFull ? truncateAtWord(descriptionFull, 240) : undefined;
}

export function parseSeoTitle($: cheerio.CheerioAPI) {
  return clean(parseMeta($, 'og:title') || $('title').first().text());
}

export function parseMeta($: cheerio.CheerioAPI, name: string) {
  return clean(
    $(`meta[name="${name}"], meta[property="${name}"]`)
      .first()
      .attr('content') || '',
  );
}

export function parseBreadcrumbNames($: cheerio.CheerioAPI) {
  return $('.rsbreadcrumb [itemprop="name"]')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}

export function parseOldPrice($: cheerio.CheerioAPI, currentPrice?: number) {
  const candidates = [
    '.old-price',
    '.price-old',
    '.price__old',
    '.oldprice',
    '.price.gen del',
    'del',
  ];

  for (const selector of candidates) {
    const value = parsePrice($(selector).first().text());
    if (value && (!currentPrice || value > currentPrice)) return value;
  }

  return undefined;
}

export function parseStockStatus(
  $: cheerio.CheerioAPI,
  jsonLdAvailability?: string,
): DukonStockStatus {
  const availability = jsonLdAvailability?.toLowerCase() || '';
  if (availability.includes('outofstock')) return 'out_of_stock';
  if (availability.includes('preorder')) return 'preorder';
  if (availability.includes('instock')) return 'in_stock';

  const pageText = clean(
    $('.availability, .stock, .quantity, .product-info, .detail-product__info')
      .text()
      .toLowerCase(),
  );

  if (/нет в наличии|отсутствует|закончился/.test(pageText)) {
    return 'out_of_stock';
  }
  if (/под заказ|предзаказ|ожидается/.test(pageText)) return 'preorder';
  if (/в наличии|есть в наличии|на складе/.test(pageText)) return 'in_stock';

  return 'unknown';
}

export function parseModelCodeFromName(name: string) {
  const normalized = clean(name);
  const spacedCode = normalized.match(/([A-ZА-Я]{2,}\s+\d[\wА-Яа-я.-]*)$/u);
  if (spacedCode) return spacedCode[1];

  const tailCode = normalized.match(
    /([A-ZА-Я0-9]+[\wА-Яа-я.-]*\d[\wА-Яа-я.-]*)$/u,
  );
  return tailCode?.[1];
}

export function normalizeCurrency(value?: string) {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'RUB' || normalized === 'RUR') return 'RUB';
  if (normalized === 'BYN' || normalized.includes('BYN')) return 'BYN';
  return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
}

export function parsePrice(value: string) {
  const price = Number.parseFloat(
    value.replace(/[^\d.,]/g, '').replace(',', '.'),
  );
  return Number.isFinite(price) ? price : undefined;
}

export function absoluteUrl(url: string) {
  if (url.startsWith('http')) return url;
  return `${DUKON_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
