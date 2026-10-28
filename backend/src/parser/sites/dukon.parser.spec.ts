import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The helpers are plain functions now; the spec calls them directly.
import * as parser from './dukon.parse';

describe('dukon.parse helpers', () => {
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

  it('rejects a category listing even when it has Product JSON-LD', () => {
    const category = cheerio.load(`
      <h1>Шкафы для газовых баллонов</h1>
      <script type="application/ld+json">
        {"@type":"Product","name":"Шкафы для газовых баллонов"}
      </script>
      <div class="prod-list__item"></div>
    `);
    expect(parser.isProductPage(category)).toBe(false);
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

  it('parses brand-page cards and PAGEN_2 pagination', () => {
    const brand = cheerio.load(`
      <div class="js-element" data-detail="/catalog/telezhki/one/"></div>
      <div class="js-element" data-detail="/catalog/telezhki/two/"></div>
      <div class="ajaxpages">
        <a data-navpagecount="4"></a>
      </div>
      <div id="paginator">
        <a href="/brands/nordberg/?PAGEN_2=2">2</a>
      </div>
    `);

    expect(parser.parseCatalogProductUrls(brand)).toEqual([
      'https://dukon.by/catalog/telezhki/one/',
      'https://dukon.by/catalog/telezhki/two/',
    ]);
    expect(
      parser.parseCatalogPaginationUrls(
        brand,
        'https://dukon.by/brands/nordberg/',
      ),
    ).toEqual([
      'https://dukon.by/brands/nordberg/?PAGEN_2=2',
      'https://dukon.by/brands/nordberg/?PAGEN_2=3',
      'https://dukon.by/brands/nordberg/?PAGEN_2=4',
    ]);
  });

  it('parses the brand index and its pagination count', () => {
    const index = cheerio.load(`
      <div class="js-element" data-detail="/brands/nordberg/"></div>
      <a href="/brands/other-brand/">Other</a>
      <a href="/brands/?PAGEN_2=2">2</a>
      <div id="paginator">
        <font class="text">1 - 20 из 141</font>
      </div>
    `);

    expect(parser.parseBrandLinks(index)).toEqual([
      'https://dukon.by/brands/nordberg/',
      'https://dukon.by/brands/other-brand/',
    ]);
    expect(
      parser.parseCatalogPaginationUrls(index, 'https://dukon.by/brands/'),
    ).toEqual([
      'https://dukon.by/brands/?PAGEN_2=2',
      'https://dukon.by/brands/?PAGEN_2=3',
      'https://dukon.by/brands/?PAGEN_2=4',
      'https://dukon.by/brands/?PAGEN_2=5',
      'https://dukon.by/brands/?PAGEN_2=6',
      'https://dukon.by/brands/?PAGEN_2=7',
      'https://dukon.by/brands/?PAGEN_2=8',
    ]);
  });

  it('ignores offsite brand and pagination links', () => {
    const page = cheerio.load(`
      <a href="https://evil.example/brands/nordberg/">Nordberg</a>
      <div data-detail="https://evil.example/brands/other/"></div>
      <a href="https://evil.example/brands/nordberg/?PAGEN_2=2">2</a>
      <div id="paginator">
        <a href="https://evil.example/brands/?PAGEN_2=9">9</a>
      </div>
    `);

    expect(parser.parseBrandLinks(page)).toEqual([]);
    expect(
      parser.parseCatalogPaginationUrls(page, 'https://dukon.by/brands/'),
    ).toEqual([]);
    expect(parser.parseCatalogProductUrls(page)).toEqual([]);
    expect(
      parser.parsePaginationParam(
        cheerio.load(`
          <div id="paginator">
            <a href="https://evil.example/catalog/x/?PAGEN_2=9">9</a>
          </div>
        `),
        'https://dukon.by/catalog/x/',
      ),
    ).toBe('PAGEN_1');
  });

  it('does not treat PAGEN_2 pagination links as categories', () => {
    const page = cheerio.load(`
      <a class="psection" href="/catalog/instrumenty/?PAGEN_2=3">3</a>
      <a class="psection" href="/catalog/instrumenty/">Инструменты</a>
    `);

    expect(parser.hasPagination('https://dukon.by/catalog/x/?PAGEN_2=3')).toBe(
      true,
    );
    expect(
      parser.parseCatalogCategoryUrls(page, 'https://dukon.by/catalog/'),
    ).toEqual(['https://dukon.by/catalog/instrumenty/']);
  });

  it('does not regenerate every page number on a paginated page', () => {
    const page = cheerio.load(`
      <div class="ajaxpages"><a data-navpagecount="100"></a></div>
      <div id="paginator">
        <a href="/catalog/x/?PAGEN_1=1">1</a>
        <a href="/catalog/x/?PAGEN_1=3">3</a>
        <a href="/catalog/x/?PAGEN_1=100">100</a>
      </div>
    `);

    expect(
      parser.parseCatalogPaginationUrls(
        page,
        'https://dukon.by/catalog/x/?PAGEN_1=2',
      ),
    ).toEqual([
      'https://dukon.by/catalog/x/?PAGEN_1=1',
      'https://dukon.by/catalog/x/?PAGEN_1=3',
      'https://dukon.by/catalog/x/?PAGEN_1=100',
    ]);
  });

  describe('brand', () => {
    const spec = (name: string, value: string) => ({ name, value });
    const empty = cheerio.load('<html></html>');

    it('takes the manufacturer from the spec table', () => {
      expect(
        parser.resolveBrand(
          empty,
          [spec('Производитель', 'Nordberg')],
          undefined,
          [],
        ),
      ).toBe('Nordberg');
    });

    // «Производительность» contains «производитель»: a compressor's air flow
    // became the brand «420 литров/мин».
    it('does not take «Производительность» for the manufacturer', () => {
      expect(
        parser.resolveBrand(
          empty,
          [
            spec('Производительность', '420 литров/мин'),
            spec('Производитель / бренд', 'Fubag'),
          ],
          undefined,
          [],
        ),
      ).toBe('Fubag');
    });

    it('rejects a legal entity and falls through to the next candidate', () => {
      // dukon's "Производитель" is frequently the company record. A wrong brand
      // is worse than none: brand+sku is one of only two signals that auto-merge
      // duplicates, so it would silently fuse unrelated products.
      expect(
        parser.resolveBrand(
          empty,
          [
            spec(
              'Производитель',
              'ООО «Нордберг Руссия», г. Москва, ул. Ленина, д. 1',
            ),
            spec('Бренд', 'Nordberg'),
          ],
          undefined,
          [],
        ),
      ).toBe('Nordberg');
    });

    it.each([
      'ООО "Инструмент-Сервис"',
      'ИП Иванов И.И.',
      'Nordberg GmbH',
      'г. Минск, ул. Притыцкого 29',
    ])('rejects %s', (value) => {
      expect(
        parser.resolveBrand(
          empty,
          [spec('Производитель', value)],
          undefined,
          [],
        ),
      ).toBeUndefined();
    });

    it('rejects a value too long to be a name', () => {
      expect(
        parser.resolveBrand(
          empty,
          [
            spec(
              'Производитель',
              'Завод по производству пневматического инструмента и оснастки',
            ),
          ],
          undefined,
          [],
        ),
      ).toBeUndefined();
    });

    it('rejects the product category echoed back as a brand', () => {
      expect(
        parser.resolveBrand(
          empty,
          [spec('Производитель', 'Запчасти')],
          undefined,
          ['Каталог', 'Запчасти'],
        ),
      ).toBeUndefined();
    });

    it('keeps a real name that merely starts with a category word', () => {
      expect(
        parser.resolveBrand(
          empty,
          [spec('Производитель', 'Запчасти Rotake')],
          undefined,
          ['Каталог', 'Запчасти'],
        ),
      ).toBe('Запчасти Rotake');
    });

    it('falls back to JSON-LD when the table has nothing usable', () => {
      expect(parser.resolveBrand(empty, [], 'Rotake', [])).toBe('Rotake');
    });
  });
});
