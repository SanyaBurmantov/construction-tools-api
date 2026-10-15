import { isRealBrandName, normalizeBrandName } from './brand-name';

describe('normalizeBrandName', () => {
  it('keeps real brands, including Cyrillic and numbered ones', () => {
    for (const name of [
      'Makita',
      'King Tony',
      'ВОЛАТ',
      'ЗАВОД № 1',
      'M7',
      '3TON',
      'Запорожье',
      'ЗУБР',
      'МЭЗ/Аркус',
    ]) {
      expect(normalizeBrandName(name)).toBe(name);
    }
  });

  it('collapses whitespace but keeps the supplier casing', () => {
    expect(normalizeBrandName('  King   Tony ')).toBe('King Tony');
    expect(normalizeBrandName('MAKITA')).toBe('MAKITA');
  });

  it('rejects the "no brand" values found in production', () => {
    expect(normalizeBrandName('без товарного знака')).toBeNull();
    expect(normalizeBrandName('Без Товарного Знака')).toBeNull();
    expect(normalizeBrandName('нет')).toBeNull();
    expect(normalizeBrandName('-')).toBeNull();
    expect(normalizeBrandName('—')).toBeNull();
    expect(normalizeBrandName(',')).toBeNull();
    expect(normalizeBrandName('Прочий')).toBeNull();
    expect(normalizeBrandName('Разное')).toBeNull();
    expect(normalizeBrandName('NoName')).toBeNull();
    expect(normalizeBrandName('')).toBeNull();
    expect(normalizeBrandName(null)).toBeNull();
  });

  it('rejects the spare-parts bucket in every spelling', () => {
    for (const name of [
      'запчасти',
      'Запчасти М-7',
      'Запчасти Rotake',
      'Запчасти-Forsage',
      'Запчасти-Forsage стенды,PL-4',
      'запчасти-вело',
      'запчасти-Evrika',
      'Запчасти-гайковерты',
    ]) {
      expect(normalizeBrandName(name)).toBeNull();
    }
  });

  it('rejects product groups a supplier put in its brand column', () => {
    expect(normalizeBrandName('Измерители')).toBeNull();
    expect(normalizeBrandName('Наборы')).toBeNull();
    expect(normalizeBrandName('Перчатки')).toBeNull();
    expect(normalizeBrandName('Съёмники')).toBeNull();
  });

  it('rejects a legal address in the brand field', () => {
    expect(
      normalizeBrandName(
        'Robert BOSCH GmbH, D-70771 Leinfelden, Max-Lang-Str. 40-46 Germany',
      ),
    ).toBeNull();
  });

  it('isRealBrandName mirrors it', () => {
    expect(isRealBrandName('Bosch')).toBe(true);
    expect(isRealBrandName('запчасти')).toBe(false);
  });
});
