import {
  isValidAccount,
  isValidBic,
  isValidUnp,
  normalizeAccount,
  normalizeUnp,
} from './requisites';

describe('requisites', () => {
  describe('УНП', () => {
    it('accepts real numbers with a correct check digit', () => {
      // The shop's own УНП and Belarusbank's.
      expect(isValidUnp('391807521')).toBe(true);
      expect(isValidUnp('100325912')).toBe(true);
      expect(isValidUnp(' 391 807 521 ')).toBe(true);
    });

    it('rejects a typo in any digit', () => {
      expect(isValidUnp('391807522')).toBe(false);
      expect(isValidUnp('391807251')).toBe(false);
    });

    it('rejects the wrong length and garbage', () => {
      expect(isValidUnp('39180752')).toBe(false);
      expect(isValidUnp('3918075210')).toBe(false);
      expect(isValidUnp('ООО')).toBe(false);
      expect(isValidUnp('')).toBe(false);
    });

    it('accepts the private-person form by shape, Cyrillic letters too', () => {
      expect(isValidUnp('AB1234567')).toBe(true);
      expect(isValidUnp('АВ1234567')).toBe(true);
      expect(normalizeUnp('ав 1234567')).toBe('AB1234567');
    });
  });

  describe('расчётный счёт', () => {
    it('accepts a BY IBAN with a correct checksum, spaces and case ignored', () => {
      expect(isValidAccount('BY15AKBB30120000000040000000')).toBe(true);
      expect(isValidAccount('by15 akbb 3012 0000 0000 4000 0000')).toBe(true);
      expect(normalizeAccount('by15 akbb 3012')).toBe('BY15AKBB3012');
    });

    it('rejects a broken checksum, a foreign IBAN and a short one', () => {
      expect(isValidAccount('BY16AKBB30120000000040000000')).toBe(false);
      expect(isValidAccount('BY15AKBB30120000000040000001')).toBe(false);
      expect(isValidAccount('DE89370400440532013000')).toBe(false);
      expect(isValidAccount('BY15AKBB3012')).toBe(false);
    });
  });

  describe('БИК', () => {
    it('accepts 8 and 11 character Belarusian BICs', () => {
      expect(isValidBic('AKBBBY2X')).toBe(true);
      expect(isValidBic('alfaby2x')).toBe(true);
      expect(isValidBic('AKBBBY2XXXX')).toBe(true);
    });

    it('rejects foreign and malformed codes', () => {
      expect(isValidBic('DEUTDEFF')).toBe(false);
      expect(isValidBic('AKBBBY2')).toBe(false);
      expect(isValidBic('153001369')).toBe(false);
    });
  });
});
