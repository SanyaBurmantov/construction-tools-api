import { ProductStatus } from '@prisma/client';
import {
  aiMayMoveProductUrl,
  slugFromName,
  slugFromNameAndCode,
} from './product-slug';

describe('aiMayMoveProductUrl', () => {
  it('moves only a draft — an address that was never public', () => {
    expect(aiMayMoveProductUrl({ status: ProductStatus.DRAFT })).toBe(true);
    for (const status of [
      ProductStatus.PUBLISHED,
      ProductStatus.HIDDEN,
      ProductStatus.ARCHIVED,
    ]) {
      expect(aiMayMoveProductUrl({ status })).toBe(false);
    }
  });

  it('refuses when the status was not read', () => {
    expect(aiMayMoveProductUrl({})).toBe(false);
  });

  it('moves a draft once: a slug that is already ours stays', () => {
    const draft = { status: ProductStatus.DRAFT };
    expect(aiMayMoveProductUrl({ ...draft, aiLockedFields: ['slug'] })).toBe(
      false,
    );
    expect(aiMayMoveProductUrl({ ...draft, lockedFields: ['slug'] })).toBe(
      false,
    );
    expect(aiMayMoveProductUrl({ ...draft, aiLockedFields: ['name'] })).toBe(
      true,
    );
  });
});

describe('slugFromName', () => {
  it('cuts a long name at a word boundary', () => {
    const slug = slugFromName('Перфоратор аккумуляторный '.repeat(10));
    expect(slug.length).toBeLessThanOrEqual(90);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('slugFromNameAndCode', () => {
  const clip =
    'Клипса для крепления внутренней обшивки а/м Nissan, Пежо, Рено пластиковая (100шт/уп)';

  it('keeps the article whole however long the name', () => {
    const a = slugFromNameAndCode(clip, 'C0256[Nissan/Peugeot/Renault]');
    const b = slugFromNameAndCode(clip, 'C0872[C872][Nissan/Peugeot/Renault]');
    expect(a).not.toBe(b);
    expect(a.endsWith('-c0256-nissan-peugeot-renault')).toBe(true);
    expect(a.length).toBeLessThanOrEqual(90);
    expect(a.startsWith('klipsa-dlya-krepleniya')).toBe(true);
    expect(a).not.toMatch(/--|-$/);
  });

  it('is the plain name slug without a code or when the name already ends in it', () => {
    expect(slugFromNameAndCode('Дрель BULL BM 2', null)).toBe(
      slugFromName('Дрель BULL BM 2'),
    );
    expect(slugFromNameAndCode('Метчик M10 GARWIN 122405', '122405')).toBe(
      slugFromName('Метчик M10 GARWIN 122405'),
    );
  });

  it('a short name keeps everything', () => {
    expect(slugFromNameAndCode('Бита PH2', 'B-25')).toBe('bita-ph2-b-25');
  });
});
