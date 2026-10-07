import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTools } from './tools.parser';

const html = readFileSync(
  join(__dirname, 'fixtures/tools-by-product.html'),
  'utf-8',
);

describe('parseTools', () => {
  const parsed = parseTools(html);

  it('recognises a product page and reads its identity', () => {
    expect(parsed.isProductPage).toBe(true);
    expect(parsed.productId).toBe('866744788');
    expect(parsed.sku).toBe('24102');
  });

  it('keeps the parenthetical clarification out of the name', () => {
    expect(parsed.name).toBe(
      'Коврик "ТРАВКА", 45х60 см, на противоскользящей основе, черный, VORTEX',
    );
    expect(parsed.name).not.toContain('(');
  });

  it('takes the price of THIS product, not of a recommended one', () => {
    // The page also carries recommendation cards with their own data-price;
    // the value below belongs to the block whose data-product-id is the h1's.
    expect(parsed.price).toBe(13.22);
  });

  it('ignores the "0.00" price the shop publishes in JSON-LD', () => {
    expect(parsed.price).not.toBe(0);
  });

  it('reads brand and availability from JSON-LD', () => {
    expect(parsed.brand).toBe('ВОРТЕКС');
    expect(parsed.inStock).toBe(true);
  });

  it('keeps the barcode — it is what merges this offer with другой поставщик', () => {
    expect(parsed.barcode).toBe('4660011273907');
  });

  it('returns one URL per photo, at the largest size', () => {
    expect(parsed.images).toHaveLength(5);
    expect(parsed.images.every((url) => url.endsWith('-1200x900.jpg'))).toBe(
      true,
    );
    // The gallery serves -640x480 and -160x120 of the same photo; a naive
    // collector would report the same image three times.
    expect(new Set(parsed.images).size).toBe(parsed.images.length);
  });

  it('only takes gallery photos, never a recommended product’s', () => {
    const galleryFolder = parsed.images[0].split('/').slice(0, -2).join('/');
    expect(parsed.images.every((url) => url.startsWith(galleryFolder))).toBe(
      true,
    );
  });

  it('builds the category chain without the brand filter or the back button', () => {
    expect(parsed.breadcrumbs).toEqual([
      'Товары для дома',
      'Товары для уборки',
      'Коврики придверные',
    ]);
    expect(parsed.breadcrumbs).not.toContain('← Назад');
    // The last crumb links to ?brand_id=… — a filter, not a category.
    expect(parsed.breadcrumbs).not.toContain('ВОРТЕКС');
  });

  it('collects specs from both the characteristics list and the info table', () => {
    const byName = Object.fromEntries(
      parsed.specifications.map((spec) => [spec.name, spec.value]),
    );

    expect(byName['Размер']).toBe('45х60 см.');
    expect(byName['Страна изготовления']).toBe('Россия');
    expect(byName['Вес с упаковкой, кг']).toBe('0.625');
  });

  it('does not treat a category page as a product', () => {
    const result = parseTools('<html><body><h1>Каталог</h1></body></html>');

    expect(result.isProductPage).toBe(false);
    expect(result.price).toBeUndefined();
    expect(result.images).toEqual([]);
  });
});

describe('Tools.by complete content', () => {
  it('preserves full description rather than only the title clarification', () => {
    const parsed = parseTools(
      '<h1 class="product__title" data-product-id="1">Товар<span class="short-description">Коротко</span></h1><div class="product__description"><p>Полное описание воздуходувки.</p><table><tr><td>Служебная строка</td></tr></table></div>',
    );
    expect(parsed.description).toContain('Полное описание воздуходувки.');
    expect(parsed.description).not.toContain('Служебная строка');
  });
  it('does not truncate galleries at twelve photos', () => {
    const images = Array.from(
      { length: 15 },
      (_, i) => `<img src="/photos/${i}-1200x900.jpg">`,
    ).join('');
    expect(
      parseTools(`<div class="product__carousel">${images}</div>`).images,
    ).toHaveLength(15);
  });
});
