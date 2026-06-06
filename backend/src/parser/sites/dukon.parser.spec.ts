import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DukonParserService } from './dukon.parser';

type DukonParserTestAccess = {
  parseSpecs: ($: cheerio.CheerioAPI) => { name: string; value: string }[];
  findSpecValue: (
    specs: { name: string; value: string }[],
    needle: string,
  ) => string | undefined;
  parsePrice: (value: string) => number | undefined;
  parseDescription: ($: cheerio.CheerioAPI) => string;
  parseImages: (
    $: cheerio.CheerioAPI,
    name: string,
    jsonLdImages?: string[],
  ) => { url: string; alt: string; order: number }[];
  parseJsonLdProduct: ($: cheerio.CheerioAPI) => {
    sku?: string;
    mpn?: string;
    brand?: string;
    price?: number;
    currency?: string;
    availability?: string;
    images: string[];
  };
  parseStockStatus: (
    $: cheerio.CheerioAPI,
    jsonLdAvailability?: string,
  ) => string;
  parseDescriptionShort: (
    $: cheerio.CheerioAPI,
    descriptionFull: string,
  ) => string | undefined;
  parseCurrentCategoryNames: ($: cheerio.CheerioAPI) => string[];
  parseCatalogProductUrls: ($: cheerio.CheerioAPI) => string[];
  parseCatalogPaginationUrls: (
    $: cheerio.CheerioAPI,
    pageUrl: string,
  ) => string[];
  parseChildCategoryLinks: (
    $: cheerio.CheerioAPI,
  ) => { name: string; url: string }[];
  isProductPage: ($: cheerio.CheerioAPI) => boolean;
};

describe('DukonParserService parsing helpers', () => {
  const service = new DukonParserService({} as never, {} as never);
  const parser = service as unknown as DukonParserTestAccess;
  const html = readFileSync(
    join(__dirname, 'fixtures', 'dukon-product.html'),
    'utf8',
  );
  const $ = cheerio.load(html);

  it('parses product identity, price and description from Dukon fixture', () => {
    const specs = parser.parseSpecs($);

    expect(parser.isProductPage($)).toBe(true);
    expect(parser.findSpecValue(specs, 'артикул')).toBe('DUKON-123');
    expect(parser.findSpecValue(specs, 'производитель')).toBe('Nordberg');
    expect(parser.parsePrice($('.price.gen').first().text())).toBe(384.82);
    expect(parser.parseDescription($)).toBe('Тестовое описание товара Dukon.');
    expect(parser.parseDescriptionShort($, parser.parseDescription($))).toBe(
      'SEO описание тестового товара Dukon.',
    );
  });

  it('parses rich json-ld and stock data from Dukon fixture', () => {
    const jsonLd = parser.parseJsonLdProduct($);

    expect(jsonLd.sku).toBe('DUKON-123');
    expect(jsonLd.mpn).toBe('N32030 G');
    expect(jsonLd.brand).toBe('Nordberg');
    expect(jsonLd.price).toBe(384.82);
    expect(jsonLd.currency).toBe('BYN');
    expect(parser.parseStockStatus($, jsonLd.availability)).toBe('in_stock');
  });

  it('parses json-ld and gallery images as absolute Dukon URLs', () => {
    expect(parser.parseImages($, 'Товар')).toEqual([
      {
        url: 'https://dukon.by/upload/iblock/product-main.jpg',
        alt: 'Товар',
        order: 0,
      },
      {
        url: 'https://dukon.by/upload/iblock/product-extra.jpg',
        alt: 'Товар',
        order: 1,
      },
      {
        url: 'https://dukon.by/upload/iblock/gallery-1.jpg',
        alt: 'Товар',
        order: 2,
      },
      {
        url: 'https://dukon.by/upload/iblock/gallery-2.jpg',
        alt: 'Товар',
        order: 3,
      },
    ]);
  });

  it('parses category path, child categories, products and pagination', () => {
    expect(parser.parseCurrentCategoryNames($)).toEqual([
      'Наборы инструментов и специнструмент',
      'Наборы инструментов',
      'Набор инструментов тестовый DUKON-123',
    ]);
    expect(parser.parseChildCategoryLinks($)).toEqual([
      {
        name: 'Наборы ключей',
        url: 'https://dukon.by/catalog/nabory-instrumentov/nabory-klyuchey/',
      },
    ]);
    expect(parser.parseCatalogProductUrls($)).toEqual([
      'https://dukon.by/catalog/nabory-instrumentov/product-one/',
      'https://dukon.by/catalog/nabory-instrumentov/product-two/',
    ]);
    expect(
      parser.parseCatalogPaginationUrls(
        $,
        'https://dukon.by/catalog/nabory-instrumentov/',
      ),
    ).toEqual([
      'https://dukon.by/catalog/nabory-instrumentov/?PAGEN_1=2',
      'https://dukon.by/catalog/nabory-instrumentov/?PAGEN_1=3',
      'https://dukon.by/catalog/nabory-instrumentov/?PAGEN_1=4',
    ]);
  });
});
