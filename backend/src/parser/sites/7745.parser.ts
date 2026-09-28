import * as cheerio from 'cheerio';
import { TParsedProduct } from '../types/parsed-product.type';

const SOURCE_BASE_URL = 'https://7745.by';

type JsonRecord = Record<string, unknown>;

type ParsedJsonLdProduct = {
  name?: string;
  description?: string;
  price?: number;
  images: string[];
};

export function parse7745(html: string): TParsedProduct {
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLdProduct($);

  const name = clean(
    $('h1').first().text() ||
      jsonLd.name ||
      parseMeta($, 'og:title') ||
      $('title').first().text(),
  );

  const price =
    parsePrice(
      $('.price, .product-price, .price-current, [class*="price"]')
        .first()
        .text(),
    ) || jsonLd.price;

  const images = parseImages($, jsonLd.images);
  const specifications = parseSpecs($);
  const description =
    parseDescription($) || jsonLd.description || parseMeta($, 'description');

  return {
    name,
    price,
    images,
    description,
    specifications,
  };
}

function parseSpecs($: cheerio.CheerioAPI) {
  const specs = new Map<string, string>();

  $(
    '.specifications tr, .properties tr, .chars tr, .characteristics tr, .product-params tr',
  ).each((_, el) => {
    const cells = $(el).find('td, th');
    addSpec(specs, cells.eq(0).text(), cells.eq(1).text());
  });

  $(
    '.specifications li, .properties li, .chars li, .characteristics li, .product-params li',
  ).each((_, el) => {
    const label = $(el).find('.name, .label, .title, [class*="name"]').first();
    const value = $(el).find('.value, .val, [class*="value"]').first();
    if (label.length && value.length) {
      addSpec(specs, label.text(), value.text());
      return;
    }

    const text = clean($(el).text());
    const [name, ...rest] = text.split(':');
    addSpec(specs, name, rest.join(':'));
  });

  $('.properties__item, .characteristics__item, .product-params__item').each(
    (_, el) => {
      addSpec(
        specs,
        $(el).find('.name, .label, .title, [class*="name"]').first().text(),
        $(el).find('.value, .val, [class*="value"]').first().text(),
      );
    },
  );

  $('.preview-characteristics_item, .dot-leaders_item').each((_, el) => {
    addSpec(
      specs,
      $(el).find('.dot-leaders_prop, [class*="prop"]').first().text(),
      $(el).find('.dot-leaders_value, [class*="value"]').first().text(),
    );
  });

  $('[itemprop="sku"]').each((_, el) => {
    const value = $(el).attr('content') || $(el).text();
    addSpec(specs, 'Артикул', value || '');
  });

  $('[itemprop="serialNumber"]').each((_, el) => {
    const value = $(el).attr('content') || $(el).text();
    addSpec(specs, 'Серийный номер', value || '');
  });

  return [...specs.entries()].map(([name, value]) => ({ name, value }));
}

function parseImages($: cheerio.CheerioAPI, jsonLdImages: string[] = []) {
  const urls = new Set<string>();

  for (const image of jsonLdImages) {
    if (isProductImage(image)) urls.add(absoluteUrl(image));
  }

  $(
    'meta[property="og:image"], meta[itemprop="image"], [itemprop="image"]',
  ).each((_, el) => {
    const src = $(el).attr('content') || $(el).attr('src');
    if (src && isProductImage(src)) urls.add(absoluteUrl(src));
  });

  $(
    '.product-image img, .product-images img, .product-gallery img, .gallery img, [class*="product"] img',
  ).each((_, el) => {
    const src =
      $(el).attr('data-src') ||
      $(el).attr('data-original') ||
      $(el).attr('src') ||
      $(el).closest('a').attr('href');

    if (src && isProductImage(src)) {
      urls.add(absoluteUrl(src));
    }
  });

  return [...urls].slice(0, 12);
}

function parseDescription($: cheerio.CheerioAPI) {
  return clean(
    $(
      '.product-description, .description, #description, .detail-text, [class*="description"]',
    )
      .first()
      .text(),
  );
}

function parseJsonLdProduct($: cheerio.CheerioAPI): ParsedJsonLdProduct {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text()) as unknown;
      const product = findJsonLdProduct(parsed);
      if (!product) continue;

      const offersValue = product.offers;
      const offers = Array.isArray(offersValue)
        ? asRecord(offersValue[0])
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
        name: readString(product, 'name'),
        description: readString(product, 'description'),
        price: parsePrice(
          typeof offerPrice === 'string' || typeof offerPrice === 'number'
            ? String(offerPrice)
            : '',
        ),
        images,
      };
    } catch {
      // Ignore unrelated or invalid schema scripts.
    }
  }

  return { images: [] };
}

function findJsonLdProduct(value: unknown): JsonRecord | undefined {
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

function addSpec(specs: Map<string, string>, name: string, value: string) {
  const cleanName = clean(name).replace(/:$/, '');
  const cleanValue = clean(value);
  if (cleanName && cleanValue) specs.set(cleanName, cleanValue);
}

function parsePrice(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return undefined;

  const price = Number.parseFloat(match[0]);
  return Number.isFinite(price) ? price : undefined;
}

function parseMeta($: cheerio.CheerioAPI, name: string) {
  return clean(
    $(`meta[name="${name}"], meta[property="${name}"]`)
      .first()
      .attr('content') || '',
  );
}

function readString(record: JsonRecord | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? clean(value) : undefined;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? (value as JsonRecord) : undefined;
}

function isProductImage(url: string) {
  const normalized = url.toLowerCase();
  return (
    !normalized.startsWith('data:') &&
    !normalized.includes('/resize_cache/') &&
    !normalized.includes('/bitrix/templates/') &&
    !normalized.includes('/local/templates/') &&
    !normalized.includes('/docs/') &&
    !normalized.includes('guarantee') &&
    !normalized.includes('credit_') &&
    !normalized.includes('logo') &&
    !normalized.includes('sprite') &&
    /\.(jpe?g|png|webp)(?:\?|$)/.test(normalized)
  );
}

function absoluteUrl(url: string) {
  if (url.startsWith('http')) return url;
  return `${SOURCE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
