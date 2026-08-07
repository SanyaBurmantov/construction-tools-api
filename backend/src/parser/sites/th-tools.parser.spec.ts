import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseThTools } from './th-tools.parser';

const html = readFileSync(
  join(__dirname, 'fixtures', 'th-tools-product.html'),
  'utf8',
);

describe('parseThTools', () => {
  const parsed = parseThTools(html);

  it('parses product identity', () => {
    expect(parsed.name).toBe(
      'Шарошка сферическая вытянутая по металлу(Ø 8мм,Ø хвостовика 6мм),в пластиковом футляре',
    );
    expect(parsed.sku).toBe('F-617E0813');
    expect(parsed.brand).toBe('Forsage');
    expect(parsed.isProductPage).toBe(true);
  });

  it('reads the machine-readable price rather than the localised text', () => {
    expect(parsed.price).toBe(34.37);
  });

  it('extracts the barcode, which is the only auto-merge signal we get here', () => {
    expect(parsed.barcode).toBe('4811450249828');
  });

  it('does not mistake the internal "Код" column for the supplier article', () => {
    expect(parsed.sku).not.toBe('49053');
  });

  it('does not mistake the "Поставщик" factory for a brand', () => {
    expect(parsed.brand).not.toBe('Sichuan');
  });

  it('reads schema.org availability', () => {
    expect(parsed.inStock).toBe(true);
  });

  it('drops the "Главная" navigation crumb from the category chain', () => {
    expect(parsed.breadcrumbs).toEqual([
      'Ручной инструмент',
      'Металлообработка',
      'Шарошки',
    ]);
  });

  it('stores each photo once, at its largest variant', () => {
    // The page offers every photo at .750x0, .970 and .0x600 — collecting them
    // naively stored three rows per photo.
    expect(parsed.images).toEqual([
      'https://th-tool.by/wa-data/public/shop/products/80/36/463680/images/6889614/6889614.970.webp',
      'https://th-tool.by/wa-data/public/shop/products/80/36/463680/images/6889615/6889615.970.webp',
      'https://th-tool.by/wa-data/public/shop/products/80/36/463680/images/6889616/6889616.970.webp',
    ]);
  });

  it('parses the specification table', () => {
    expect(parsed.specifications).toEqual([
      { name: 'Бренд', value: 'Forsage' },
      { name: 'Код', value: '49053' },
      { name: 'Вес', value: '0.037 кг' },
      { name: 'Штрихкод', value: '4811450249828' },
      { name: 'Поставщик', value: 'Sichuan' },
    ]);
  });

  it('keeps the full description', () => {
    expect(parsed.description).toContain('Твердосплавная борфреза');
  });

  it('rejects a "brand" that is really the category name', () => {
    // th-tool.by lists hydraulics spares under "… / Запчасти" and puts
    // "запчасти" in the brand slot; a junk brand corrupts brand+sku matching.
    const echoed = parseThTools(`
      <nav>
        <a class="bread__link">Главная</a>
        <a class="bread__link">Оборудование</a>
        <a class="bread__link">Запчасти</a>
        <div class="bread__link bread__link_last">Манжеты</div>
      </nav>
      <h1>Манжеты</h1>
      <div class="product__top-brand-name">запчасти</div>
      <meta itemprop="price" content="14.12">
    `);
    expect(echoed.brand).toBeUndefined();
  });

  it('keeps a real brand that merely starts with a category word', () => {
    const real = parseThTools(`
      <nav>
        <a class="bread__link">Пневматика</a>
        <a class="bread__link">Запчасти для пневмоинструмента</a>
        <div class="bread__link bread__link_last">Ротор</div>
      </nav>
      <h1>Ротор</h1>
      <div class="product__top-brand-name">Запчасти Rotake</div>
      <meta itemprop="price" content="10">
    `);
    expect(real.brand).toBe('Запчасти Rotake');
  });

  it('ignores the theme placeholder used for photo-less products', () => {
    const noPhoto = parseThTools(`
      <h1>Манжеты</h1>
      <meta itemprop="price" content="14.12">
      <div class="p-images">
        <a class="p-images__slider-item"
           href="/wa-data/public/site/themes/insales/img/default.png?v1715866486"></a>
      </div>
    `);
    expect(noPhoto.images).toEqual([]);
  });

  it('recognises a non-product page', () => {
    const category = parseThTools(
      '<html><body><h1>Аксессуары</h1><div class="catalog"></div></body></html>',
    );
    expect(category.isProductPage).toBe(false);
  });
});
