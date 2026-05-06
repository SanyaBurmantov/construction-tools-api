import * as cheerio from 'cheerio';
import { ThToolsParserService } from './th-tools.parser';

type ThToolsParserTestAccess = {
  parseName: ($: cheerio.CheerioAPI) => string;
  parseBrand: ($: cheerio.CheerioAPI) => string;
  parseSku: ($: cheerio.CheerioAPI) => string;
  parseDescription: ($: cheerio.CheerioAPI) => string;
  parsePrice: (value: string) => number | undefined;
  parseImages: (
    $: cheerio.CheerioAPI,
    name: string,
  ) => { url: string; alt: string; order: number }[];
  parseSpecs: ($: cheerio.CheerioAPI) => { name: string; value: string }[];
};

describe('ThToolsParserService parsing helpers', () => {
  const service = new ThToolsParserService({} as never, {} as never);
  const parser = service as unknown as ThToolsParserTestAccess;
  const $ = cheerio.load(`
    <html>
      <head>
        <meta property="og:title" content="SEO TH товар" />
        <meta property="og:image" content="/upload/products/main.webp" />
        <meta name="description" content="SEO описание TH-Tools" />
      </head>
      <body>
        <h1>Шуруповерт тестовый TH T-77</h1>
        <div class="product__top-brand-name">Bosch</div>
        <div class="product__code">Код: <span>T-77</span></div>
        <div class="price product__price">1 234,50 BYN</div>
        <div class="desc desc_max">Полное описание TH-Tools</div>
        <a class="p-images__slider-item" href="/upload/products/gallery.jpg"></a>
        <img class="p-images__slider-item" data-src="https://th-tool.by/upload/products/extra.png" />
        <div class="features-two-val__block">
          <span class="features-two-val__name"><span>Мощность:</span></span>
          <span class="features-two-val__value">18 В</span>
        </div>
        <table class="characteristics">
          <tr><th>Вес</th><td>1.5 кг</td></tr>
        </table>
      </body>
    </html>
  `);

  it('parses product identity, price, images and specs', () => {
    expect(parser.parseName($)).toBe('Шуруповерт тестовый TH T-77');
    expect(parser.parseBrand($)).toBe('Bosch');
    expect(parser.parseSku($)).toBe('T-77');
    expect(parser.parseDescription($)).toBe('Полное описание TH-Tools');
    expect(parser.parsePrice($('.price.product__price').text())).toBe(1234.5);
    expect(parser.parseImages($, 'Товар')).toEqual([
      {
        url: 'https://th-tool.by/upload/products/main.webp',
        alt: 'Товар',
        order: 0,
      },
      {
        url: 'https://th-tool.by/upload/products/gallery.jpg',
        alt: 'Товар',
        order: 1,
      },
      {
        url: 'https://th-tool.by/upload/products/extra.png',
        alt: 'Товар',
        order: 2,
      },
    ]);
    expect(parser.parseSpecs($)).toEqual([
      { name: 'Мощность', value: '18 В' },
      { name: 'Вес', value: '1.5 кг' },
    ]);
  });
});
