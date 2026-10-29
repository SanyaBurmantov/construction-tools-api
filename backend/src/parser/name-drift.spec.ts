import { supplierIdentityChanged } from './name-drift';

describe('supplierIdentityChanged', () => {
  it('ignores rewording, case and look-alike letters', () => {
    expect(
      supplierIdentityChanged(
        'Аккум. перфоратор BOSCH GBH 18V-45 C в чем.',
        'Аккумуляторный перфоратор Bosch GBH 18V-45 C в чемодане',
      ),
    ).toBe(false);
    expect(
      supplierIdentityChanged(
        'Kлeщи для xoмутoв ШPУCa TOPTUL',
        'Клещи для хомутов ШРУСа TOPTUL',
      ),
    ).toBe(false);
  });

  it('does not mistake a brand written in another case for a new model', () => {
    expect(
      supplierIdentityChanged(
        'Дрель BULL SR 1203 в чем.',
        'Дрель Bull SR 1203, чемодан',
      ),
    ).toBe(false);
  });

  it('sees SOLO become SET', () => {
    expect(
      supplierIdentityChanged(
        'Аккум. пила BULL CBS 6583 SOLO',
        'Аккум. пила BULL CBS 6583 SET',
      ),
    ).toBe(true);
  });

  it('sees a new article, size or pack count', () => {
    expect(
      supplierIdentityChanged(
        'Перфоратор MAKITA HR2470 в чем.',
        'Перфоратор MAKITA HR2470FT в чем.',
      ),
    ).toBe(true);
    expect(
      supplierIdentityChanged(
        'Аккум. перфоратор BOSCH GBH 18V-45 C в чем.',
        'Аккум. перфоратор BOSCH GBH 18V-45 CF в чем.',
      ),
    ).toBe(true);
    expect(
      supplierIdentityChanged(
        'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
        'Анкер забиваемый М10х12х40 мм (6 шт в зип-локе) STARFIX',
      ),
    ).toBe(true);
  });

  it('never fires on an empty name', () => {
    expect(supplierIdentityChanged('', 'Дрель')).toBe(false);
  });
});
