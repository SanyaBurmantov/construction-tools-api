import {
  isIdentitySpec,
  isOffByDefaultSpec,
  isSupplierPaperworkSpec,
  publicSpecs,
  shouldBeFilterable,
} from './spec-filterable';

describe('shouldBeFilterable', () => {
  it('keeps characteristics that make sensible facets', () => {
    expect(shouldBeFilterable('Мощность', '800 Вт')).toBe(true);
    expect(shouldBeFilterable('Напряжение', '18 В')).toBe(true);
    expect(shouldBeFilterable('Тип патрона', 'SDS-plus')).toBe(true);
  });

  it('never filters by identity fields — one value per product is not a filter', () => {
    expect(shouldBeFilterable('Штрихкод', '4660011273907')).toBe(false);
    expect(shouldBeFilterable('Бренд', 'Makita')).toBe(false);
    expect(shouldBeFilterable('Артикул', '33000-150')).toBe(false);
    expect(shouldBeFilterable('Код товара', '24102')).toBe(false);
  });

  it('drops paperwork rows suppliers put in the spec table', () => {
    expect(shouldBeFilterable('Импортер/Продавец', 'ООО «ТД Комплект»')).toBe(
      false,
    );
    expect(shouldBeFilterable('Срок годности', 'не ограничен')).toBe(false);
  });

  it('rejects a value that is prose rather than a facet', () => {
    // Straight from a tools.by card: the "Производитель" cell is a full legal
    // address. Even without the name rule, the length guard catches it.
    const address =
      'ООО "Профит" / ООО "ЛинкГрупп". 115184, Россия, г. Москва, вн. тер. г. муниципальный округ Замоскворечье, ул. Малая Ордынка, д. 27/5-3';

    expect(shouldBeFilterable('Описание партии', address)).toBe(false);
  });

  it('is case- and substring-insensitive about the blocklist', () => {
    expect(shouldBeFilterable('ШТРИХКОД EAN-13', '123')).toBe(false);
    expect(shouldBeFilterable('  Производитель  ', 'Makita')).toBe(false);
  });

  it('handles a missing value and an empty name', () => {
    expect(shouldBeFilterable('Материал')).toBe(true);
    expect(shouldBeFilterable('')).toBe(false);
  });
});

describe('isSupplierPaperworkSpec', () => {
  it('flags the supplier rows the audit found on cards and product pages', () => {
    expect(isSupplierPaperworkSpec('Поставщик')).toBe(true);
    expect(isSupplierPaperworkSpec('Импортер/Продавец')).toBe(true);
    expect(isSupplierPaperworkSpec('Импортёр')).toBe(true);
    expect(isSupplierPaperworkSpec('Производитель')).toBe(true);
    expect(isSupplierPaperworkSpec('Адрес производителя')).toBe(true);
    expect(isSupplierPaperworkSpec('Изготовитель')).toBe(true);
    expect(isSupplierPaperworkSpec('Код')).toBe(true);
    expect(isSupplierPaperworkSpec('Код товара')).toBe(true);
    expect(isSupplierPaperworkSpec('Код поставщика')).toBe(true);
  });

  it('keeps consumer properties that merely contain the same letters', () => {
    expect(isSupplierPaperworkSpec('Страна производителя')).toBe(false);
    expect(isSupplierPaperworkSpec('Страна-изготовитель')).toBe(false);
    expect(isSupplierPaperworkSpec('Кодовый замок')).toBe(false);
    expect(isSupplierPaperworkSpec('Количество секретных комбинаций')).toBe(
      false,
    );
    expect(isSupplierPaperworkSpec('Штрихкод')).toBe(false);
    expect(isSupplierPaperworkSpec('Мощность')).toBe(false);
  });
});

describe('isIdentitySpec', () => {
  it('covers paperwork plus barcode, article and brand', () => {
    expect(isIdentitySpec('Поставщик')).toBe(true);
    expect(isIdentitySpec('Штрихкод')).toBe(true);
    expect(isIdentitySpec('Артикул')).toBe(true);
    expect(isIdentitySpec('Бренд')).toBe(true);
    expect(isIdentitySpec('Вес, кг')).toBe(false);
    expect(isIdentitySpec('Страна изготовления')).toBe(false);
  });
});

describe('isOffByDefaultSpec', () => {
  it('catches every spelling of weight and overall dimensions', () => {
    expect(isOffByDefaultSpec('Вес')).toBe(true);
    expect(isOffByDefaultSpec('Вес, кг')).toBe(true);
    expect(isOffByDefaultSpec('Вес с упаковкой, кг')).toBe(true);
    expect(isOffByDefaultSpec('Масса нетто')).toBe(true);
    expect(isOffByDefaultSpec('Габариты (ДхШхВ), см')).toBe(true);
    expect(isOffByDefaultSpec('Габариты (ДхШхВ)')).toBe(true);
    expect(isOffByDefaultSpec('Габариты ДxШxВ, см')).toBe(true);
    expect(isOffByDefaultSpec('Размеры упаковки')).toBe(true);
  });

  it('does not match words that only contain «вес»', () => {
    expect(isOffByDefaultSpec('Тип подвеса')).toBe(false);
    expect(isOffByDefaultSpec('Весы')).toBe(false);
    expect(isOffByDefaultSpec('Диаметр, мм')).toBe(false);
    expect(isOffByDefaultSpec('Длина')).toBe(false);
  });

  it('makes weight start out as a non-filter', () => {
    expect(shouldBeFilterable('Вес, кг', '1.2')).toBe(false);
    expect(shouldBeFilterable('Габариты (ДхШхВ), см', '20 x 1 x 1')).toBe(
      false,
    );
    expect(shouldBeFilterable('Страна изготовления', 'Китай')).toBe(true);
  });
});

describe('publicSpecs', () => {
  const spec = (name: string) => ({ name, value: 'x' });

  it('drops supplier paperwork and puts consumer properties first', () => {
    // A real dukon card: the first three used to be Бренд, Код, Вес.
    const result = publicSpecs([
      spec('Бренд'),
      spec('Код'),
      spec('Вес'),
      spec('Поставщик'),
      spec('Штрихкод'),
      spec('Тип хвостовика'),
      spec('Производитель'),
      spec('Импортер/Продавец'),
      spec('Диаметр, мм'),
    ]).map((row) => row.name);

    expect(result).toEqual([
      'Тип хвостовика',
      'Диаметр, мм',
      'Вес',
      'Бренд',
      'Штрихкод',
    ]);
  });

  it('keeps the supplier order within a rank and copies nothing extra', () => {
    const rows = [spec('Материал'), spec('Цвет')];
    expect(publicSpecs(rows)).toEqual(rows);
    expect(publicSpecs([])).toEqual([]);
  });
});
