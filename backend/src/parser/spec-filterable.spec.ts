import { shouldBeFilterable } from './spec-filterable';

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
