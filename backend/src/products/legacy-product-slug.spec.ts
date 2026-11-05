import {
  articleCandidates,
  articlePatterns,
  articleSlug,
  pickLegacyProduct,
} from './legacy-product-slug';

describe('legacy product slugs', () => {
  it('takes article candidates from the front, longest first', () => {
    expect(articleCandidates('smp-63731-1-shurup-10kh60-mm')).toEqual([
      'smp-63731-1-shurup',
      'smp-63731-1',
      'smp-63731',
    ]);
    expect(
      articleCandidates('clbc121201-remkomplekt-dlya-treshchotok'),
    ).toEqual([
      // Never the whole slug: something of the name must follow the article.
      'clbc121201-remkomplekt-dlya',
      'clbc121201-remkomplekt',
      'clbc121201',
    ]);
    // No digit, no article.
    expect(articleCandidates('nabor-instrumentov-v-dorogu')).toEqual([]);
  });

  it('turns candidates into ILIKE patterns', () => {
    expect(articlePatterns('bw-0588-detox')).toEqual(['bw_0588']);
  });

  it('slugs an article like the old addresses did', () => {
    expect(articleSlug('SMP-63731/1')).toBe('smp-63731-1');
    expect(articleSlug('BW-0588')).toBe('bw-0588');
  });

  const toptul = {
    slug: 'remkomplekt-dlya-treshchotok-cjhm1228-toptul-clbc121201',
    sku: 'CLBC121201',
    name: 'Ремкомплект для трещоток CJHM1228 TOPTUL',
  };

  it('finds the product by its article', () => {
    expect(
      pickLegacyProduct(
        'clbc121201-remkomplekt-dlya-treshchotok-cjhm1228-toptul',
        [toptul],
      ),
    ).toBe(toptul);
  });

  it('prefers the longest article', () => {
    const short = { slug: 'a', sku: 'SMP-63731', name: 'Шуруп 8х40' };
    const long = { slug: 'b', sku: 'SMP-63731-1', name: 'Шуруп 10х60' };
    expect(
      pickLegacyProduct('smp-63731-1-shurup-10kh60-mm', [short, long]),
    ).toBe(long);
  });

  it('tells same-article products apart by the name, across transliterations', () => {
    const scrub = {
      slug: 'a',
      sku: 'BW-0588',
      name: 'Вулканический скраб для рук и ног',
    };
    const other = { slug: 'b', sku: 'BW-0588', name: 'Крем для лица' };
    expect(
      pickLegacyProduct(
        'bw-0588-detox-therapy-vulkanicheskiy-skrab-dlya-ruk-i-nog-75',
        [other, scrub],
      ),
    ).toBe(scrub);
  });

  it('gives up when the same article cannot be told apart', () => {
    const a = { slug: 'a', sku: 'F-828', name: 'Набор А' };
    const b = { slug: 'b', sku: 'F-828', name: 'Набор Б' };
    expect(pickLegacyProduct('f-828-bolty-v-komplekte', [a, b])).toBeNull();
  });
});
