import * as cheerio from 'cheerio';
import { TParsedProduct } from '../types/parsed-product.type';

const TOOLS_BASE_URL = 'https://tools.by';

export function parseTools(html: string): TParsedProduct {
  const $ = cheerio.load(html);

  const name = clean(
    $('h1').first().text() ||
      $('[itemprop="name"]').first().attr('content') ||
      parseMeta($, 'og:title') ||
      $('title').first().text(),
  );

  const price = parsePrice(
    $('.js-markup-price').first().attr('data-price') ||
      $('.product-parameter__price-value, .price').first().text(),
  );
  const images = parseImages($);
  const specifications = parseSpecs($);
  const description = clean(
    $('.product__description').first().text() || parseMeta($, 'description'),
  );

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

  addSpec(specs, 'Артикул', $('#product_artikul').text());

  $('.product__description tr, .product__technical-characteristics tr').each(
    (_, el) => {
      addSpec(
        specs,
        $(el).find('.item-key, td, th').first().text(),
        $(el).find('.item-value, td, th').last().text(),
      );
    },
  );

  $('.product-parameter').each((_, el) => {
    addSpec(
      specs,
      $(el).find('[class*="key"], [class*="title"]').first().text(),
      $(el).find('[class*="value"]').first().text(),
    );
  });

  return [...specs.entries()].map(([name, value]) => ({ name, value }));
}

function parseImages($: cheerio.CheerioAPI) {
  const urls = new Set<string>();

  $('meta[property="og:image"], .product__carousel img, .carousel img').each(
    (_, el) => {
      const src = $(el).attr('content') || $(el).attr('src');
      if (src && isProductImage(src)) urls.add(absoluteUrl(src));
    },
  );

  return [...urls].slice(0, 12);
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

function isProductImage(url: string) {
  const normalized = url.toLowerCase();
  return (
    !normalized.startsWith('data:') &&
    !normalized.includes('no_photo') &&
    !normalized.includes('/logos/') &&
    !normalized.includes('favicon') &&
    /\.(jpe?g|png|webp|svg)(?:\?|$)/.test(normalized)
  );
}

function absoluteUrl(url: string) {
  if (url.startsWith('http')) return url;
  return `${TOOLS_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
