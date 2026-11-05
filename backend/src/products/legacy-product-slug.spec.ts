import {
  articleCandidates,
  articlePatterns,
  articleSlug,
  commonNamePrefix,
  itemCodes,
  pickByItemCode,
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

describe('legacy product slugs by item code', () => {
  const packs = [
    {
      slug: 'p2',
      sku: 'SMZ1-63731-2',
      name: 'Шуруп 10х60 мм шестигр. головка, цинк, DIN 571 (2 шт в зип-локе) STARFIX',
    },
    {
      slug: 'p50',
      sku: 'SMC2-63731-50',
      name: 'Шуруп 10х60 мм шестигр. головка, цинк, DIN 571 (50 шт в карт. уп.) STARFIX',
    },
    {
      slug: 'p700',
      sku: 'SM-63731-700',
      name: 'Шуруп 10х60 мм шестигр. головка, цинк, DIN 571 (700 шт в коробе) STARFIX',
    },
    { slug: 'bit', sku: 'JBC-HW-S22', name: 'Бита удлиненная PH2х100мм' },
  ];
  const address =
    'smp-63731-1-shurup-10kh60-mm-shestigr-golovka-tsink-din-571-';

  it('reads item codes', () => {
    expect(itemCodes(address)).toEqual(['63731']);
    expect(itemCodes('ach-104-konvektor')).toEqual([]);
  });

  it('sends packs of one item to a search for their common name', () => {
    expect(pickByItemCode(address, packs)).toEqual({
      search: 'Шуруп 10х60 мм шестигр. головка, цинк, DIN 571',
    });
  });

  it('goes straight to the card when only one pack is carried', () => {
    expect(pickByItemCode(address, [packs[1], packs[3]])).toEqual({
      slug: 'p50',
    });
  });

  it('does not send an address for a product to a part of it', () => {
    const membrane = {
      slug: 'membrana',
      sku: 'PA-1003-M',
      name: 'Мембрана для емкости для нагнетания густой смазки PA-1003',
    };
    expect(
      pickByItemCode(
        'pa-1003-emkost-dlya-nagnetaniya-gustoy-smazki-20l-s-pnevmona',
        [membrane],
      ),
    ).toBeNull();
  });

  it('never matches a code without the name to back it', () => {
    expect(pickByItemCode('smp-63731-1-bolt-m8', packs)).toBeNull();
  });

  it('cuts a common prefix back to whole words', () => {
    expect(commonNamePrefix(['Круг 125 мм', 'Круг 150 мм'])).toBe('Круг');
    expect(commonNamePrefix(['Набор бит 10 шт', 'Набор бит 20 шт'])).toBe(
      'Набор бит',
    );
  });
});
