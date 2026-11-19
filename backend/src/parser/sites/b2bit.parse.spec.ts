import { readFileSync } from 'fs';
import { join } from 'path';
import {
  B2bitCategoryNode,
  B2bitListing,
  B2bitProduct,
  b2bitCatalogBranch,
  b2bitCategoryPaths,
  b2bitLeafCategories,
  b2bitListingIds,
  b2bitListingUrl,
  b2bitProductId,
  b2bitProductUrl,
  b2bitSpecifications,
  parseB2bitProduct,
  pickB2bitOffer,
  sellingPrice,
  withCurrentPrice,
} from './b2bit.parse';

// Real API answers (2026-11-17) with invented prices: the repo is public and
// the dealer's purchase prices are not ours to publish.
const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8')) as T;

const tree = fixture<B2bitCategoryNode[]>('b2bit-categories.json');
const paths = b2bitCategoryPaths(tree);

describe('b2bit URLs', () => {
  it('keys an offer by the portal product page', () => {
    expect(b2bitProductUrl(1083588)).toBe('https://b2bit.by/product/1083588');
  });

  it('reads the id from portal and API product URLs', () => {
    expect(b2bitProductId('https://b2bit.by/product/1083588')).toBe('1083588');
    expect(b2bitProductId('https://b2bit.by/product/1083588?r=search')).toBe(
      '1083588',
    );
    expect(b2bitProductId('https://api.b2bit.by/api/v1/product/1083588')).toBe(
      '1083588',
    );
  });

  it('refuses category pages and foreign hosts', () => {
    expect(b2bitProductId('https://b2bit.by/catalog/1003')).toBeUndefined();
    expect(b2bitProductId('https://tools.by/product/1')).toBeUndefined();
    expect(b2bitProductId('https://evilb2bit.by/product/1')).toBeUndefined();
  });

  it('asks the listing for products with a live offer only', () => {
    const url = new URL(b2bitListingUrl(1003, 2, 100));
    expect(url.pathname).toBe('/api/v1/category/1003/products');
    expect(url.searchParams.get('unavailable')).toBe('false');
    // Without the stock flags the API answers 500.
    for (const flag of ['stock', 'reserve', 'under_order', 'transit']) {
      expect(url.searchParams.get(flag)).toBe('true');
    }
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('100');
  });
});

describe('b2bit categories', () => {
  it('knows every node by id with its chain from the root', () => {
    expect(paths.get(1003)).toEqual([
      'Стройка и ремонт',
      'Электроинструмент',
      'Электрорубанки',
    ]);
  });

  it('lists the leaves with their counts', () => {
    const leaves = b2bitLeafCategories(tree);
    const planers = leaves.find((leaf) => leaf.id === 1003);
    expect(planers).toMatchObject({ count: 11 });
    expect(leaves.some((leaf) => leaf.id === 1446)).toBe(false); // a parent
    expect(leaves.every((leaf) => leaf.path.length >= 2)).toBe(true);
  });

  it('starts our branch below «Стройка и ремонт», other roots stay', () => {
    expect(
      b2bitCatalogBranch([
        'Стройка и ремонт',
        'Электроинструмент',
        'Электрорубанки',
      ]),
    ).toEqual(['Электроинструмент', 'Электрорубанки']);
    expect(
      b2bitCatalogBranch(['Компьютеры, сети и оргтехника', 'Мониторы']),
    ).toEqual(['Компьютеры, сети и оргтехника', 'Мониторы']);
    expect(b2bitCatalogBranch(['Стройка и ремонт'])).toEqual([
      'Стройка и ремонт',
    ]);
  });

  it('reads product ids off a listing page once each', () => {
    const listing = fixture<B2bitListing>('b2bit-listing.json');
    const ids = b2bitListingIds(listing);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('parseB2bitProduct', () => {
  const parsed = parseB2bitProduct(
    fixture<B2bitProduct>('b2bit-product.json'),
    paths,
  );

  it('reads identity: name, manufacturer article, EAN, brand', () => {
    expect(parsed.productId).toBe('1083588');
    expect(parsed.name).toBe('Электрорубанок DeWalt DCP580N (DCP580N-XJ)');
    expect(parsed.sku).toBe('DCP580N-XJ');
    expect(parsed.barcode).toBe('5035048616253');
    expect(parsed.brand).toBe('DeWalt');
  });

  it('places it by the category tree', () => {
    expect(parsed.categoryId).toBe(1003);
    expect(parsed.breadcrumbs).toEqual([
      'Стройка и ремонт',
      'Электроинструмент',
      'Электрорубанки',
    ]);
  });

  it('sells at the RRP, keeps the others for the admin', () => {
    expect(parsed.price).toBe(700);
    expect(parsed.priceFrom).toBe('rrp');
    expect(parsed.purchasePrice).toBe(500);
    expect(parsed.rrp).toBe(700);
    expect(parsed.inStock).toBe(true);
    expect(parsed.hasOffer).toBe(true);
    expect(parsed.quantity).toBe(41);
  });

  it('takes every photo once', () => {
    expect(parsed.images).toHaveLength(5);
    expect(parsed.images[0]).toMatch(/^https:\/\/catalogapp\.b-cdn\.net\//);
  });

  it('puts the unit into the characteristic name, once per property', () => {
    const specs = Object.fromEntries(
      parsed.specifications.map((spec) => [spec.name, spec.value]),
    );
    expect(specs['Рабочая ширина, мм']).toBe('82');
    expect(specs['Напряжение аккумулятора, В']).toBe('18');
    expect(specs['Вес, кг']).toBe('2.5');
    expect(specs['Частота вращения вала, об/м']).toBe('15000');
    expect(specs['Страна происхождения']).toBe('КИТАЙ');
    // Groups repeat rows; each characteristic appears once.
    const names = parsed.specifications.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    // Unfilled template rows («Глубина строгания» = null) are not specs.
    expect(names.some((name) => name.startsWith('Глубина строгания'))).toBe(
      false,
    );
  });

  it('turns True/False into да/нет', () => {
    const values = parsed.specifications.map((spec) => spec.value);
    expect(values).not.toContain('True');
    expect(values).not.toContain('False');
  });

  it('never reads the slash-joined «description»', () => {
    expect(JSON.stringify(parsed)).not.toContain('15000 / 82.0');
  });
});

describe('an offer without a struck-through price but with an RRP', () => {
  const parsed = parseB2bitProduct(
    fixture<B2bitProduct>('b2bit-product-no-struck-price.json'),
    paths,
  );

  it('still sells at the RRP', () => {
    expect(parsed.inStock).toBe(true);
    expect(parsed.price).toBe(35);
    expect(parsed.purchasePrice).toBe(30);
  });
});

describe('a reserved offer', () => {
  const parsed = parseB2bitProduct(
    fixture<B2bitProduct>('b2bit-product-reserve.json'),
    paths,
  );

  it('is not in stock but keeps its price', () => {
    expect(parsed.inStock).toBe(false);
    expect(parsed.hasOffer).toBe(true);
    expect(parsed.price).toBe(130);
  });
});

describe('a product the portal no longer offers', () => {
  it('has no offer, no stock and no price', () => {
    const product = fixture<B2bitProduct>('b2bit-product.json');
    const parsed = parseB2bitProduct({ ...product, offers: [] }, paths);
    expect(parsed).toMatchObject({ hasOffer: false, inStock: false });
    expect(parsed.price).toBeUndefined();
  });

  it('has an empty chain when the tree does not know its category', () => {
    const product = fixture<B2bitProduct>('b2bit-product.json');
    const parsed = parseB2bitProduct(
      { ...product, category: { id: 999999, name: 'Новая' } },
      paths,
    );
    expect(parsed.breadcrumbs).toEqual([]);
  });
});

describe('selling price and offer choice', () => {
  it('takes the RRP, else the struck-through price', () => {
    expect(sellingPrice({ price: 100, price_old: 120, price_rrc: 150 })).toBe(
      150,
    );
    // An RRP under the struck-through price is still the RRP.
    expect(sellingPrice({ price: 100, price_old: 120, price_rrc: 110 })).toBe(
      110,
    );
    expect(sellingPrice({ price: 100, price_old: 120, price_rrc: null })).toBe(
      120,
    );
    expect(sellingPrice({ price: 100, price_old: 0, price_rrc: 0 })).toBe(
      undefined,
    );
  });

  it('refuses a number under the purchase price', () => {
    expect(sellingPrice({ price: 100, price_old: 90 })).toBeUndefined();
    expect(sellingPrice({ price: 100, price_old: 100 })).toBe(100);
    expect(sellingPrice({ price: 100, price_old: null })).toBeUndefined();
    // An RRP under the purchase falls back to the struck-through price.
    expect(sellingPrice({ price: 100, price_old: 120, price_rrc: 90 })).toBe(
      120,
    );
  });

  it('prefers an offer that can be bought, then the cheaper one', () => {
    const reserved = { available: false, price: 10, price_rrc: 11 };
    const dear = { available: true, price: 10, price_rrc: 15 };
    const cheap = { available: true, price: 10, price_old: 13 };
    expect(pickB2bitOffer([reserved, dear, cheap])).toBe(cheap);
    expect(pickB2bitOffer([])).toBeUndefined();
  });
});

describe('withCurrentPrice', () => {
  const offer = { hasOffer: true, purchasePrice: 100 };

  it('takes the RRP as it is, even under the current price', () => {
    expect(
      withCurrentPrice({ ...offer, price: 150, priceFrom: 'rrp' }, 180),
    ).toBe(150);
  });

  it('without an RRP keeps the higher of the new and the current price', () => {
    expect(
      withCurrentPrice({ ...offer, price: 120, priceFrom: 'struck' }, 150),
    ).toBe(150);
    expect(
      withCurrentPrice({ ...offer, price: 160, priceFrom: 'struck' }, 150),
    ).toBe(160);
    expect(withCurrentPrice({ ...offer, price: 120 }, null)).toBe(120);
    // No new price at all: the current one stays.
    expect(withCurrentPrice(offer, 150)).toBe(150);
    expect(withCurrentPrice(offer, null)).toBeUndefined();
  });

  it('never keeps a current price under the purchase price', () => {
    expect(withCurrentPrice({ ...offer, price: 120 }, 90)).toBe(120);
    expect(withCurrentPrice(offer, 90)).toBeUndefined();
  });

  it('drops the price when the portal no longer offers the product', () => {
    expect(
      withCurrentPrice({ hasOffer: false, price: undefined }, 150),
    ).toBeUndefined();
  });
});

describe('b2bitSpecifications', () => {
  it('maps units and keeps a unit the name already carries', () => {
    expect(
      b2bitSpecifications([
        {
          name: 'Основная информация',
          value: [
            {
              property_id: 1,
              name: 'Мощность',
              value: '2500.0',
              unit: 'Watts',
            },
            {
              property_id: 2,
              name: 'Вес, кг',
              value: '1.2',
              unit: 'Kilograms',
            },
            { property_id: 3, name: 'Класс', value: '5.8', unit: 'Parsecs' },
            {
              property_id: 4,
              name: 'Количество',
              value: '1.0',
              unit: 'Grands',
            },
            { property_id: 5, name: 'Реверс', value: 'True', unit: '' },
          ],
        },
      ]),
    ).toEqual([
      { name: 'Мощность, Вт', value: '2500' },
      { name: 'Вес, кг', value: '1.2' },
      { name: 'Класс', value: '5.8' },
      { name: 'Количество, шт', value: '1' },
      { name: 'Реверс', value: 'да' },
    ]);
  });
});
