import {
  competitorQuery,
  parseCompetitors,
  pickResultLinks,
  squash,
} from './competitors';

describe('competitorQuery', () => {
  it('brand + model code, without our supplier suffixes and its article', () => {
    const q = competitorQuery(
      'Перфоратор аккумуляторный WORTEX CRH 1810 ALL1 SOLO (CRH181000029)',
      'WORTEX',
    )!;
    expect(q.query).toBe('WORTEX CRH 1810');
    expect(q.codes).toEqual(['crh1810']);
  });

  it('a name without a code is searched by its start', () => {
    const q = competitorQuery(
      'Фитинг для пластиковых трубок с регулятором 10x10мм',
    )!;
    expect(q.codes).toEqual([]);
    expect(q.query).toBe('Фитинг для пластиковых трубок с регулятором 10x10мм');
  });
});

describe('pickResultLinks', () => {
  const q = competitorQuery('Перфоратор WORTEX CRH 1810 ALL1', 'WORTEX')!;

  it('opens product cards carrying the model, one per address, same site only', () => {
    const html = `
      <a href="/hammer_drills/">Перфораторы</a>
      <a href="/hammer_drills/crh1810all1_wortex.html?searchId=A">Перфоратор Wortex CRH 1810 ALL1</a>
      <a href="/hammer_drills/crh1810all1_wortex.html?searchId=A#reviews">отзывы</a>
      <a href="/hammer_drills/crh1822_wortex.html">Перфоратор Wortex CRH 1822</a>
      <a href="https://other.by/crh1810">CRH 1810 у других</a>
      <a href="/search/?term=wortex">ещё</a>`;
    expect(
      pickResultLinks(
        html,
        'https://www.21vek.by/search/?term=wortex+crh+1810',
        q,
      ).own,
    ).toEqual([
      'https://www.21vek.by/hammer_drills/crh1810all1_wortex.html?searchId=A',
    ]);
  });

  it('reads the code from the address when the link has only a picture', () => {
    const html = `<a href="/perforatory/wortex_crh_1810_0329266/#shop"><img alt=""></a>`;
    expect(
      pickResultLinks(html, 'https://shop.by/find/?findtext=x', q).own,
    ).toEqual(['https://shop.by/perforatory/wortex_crh_1810_0329266/']);
  });

  it("unwraps an aggregator's redirects into shops, one card per shop, ours skipped", () => {
    const html = `
      <a href="/to.php?url=https%3A%2F%2Fmirtehniki.by%2Fwortex%2Fwortex-crh-1810-all1-solo%2F&x=1">В магазин</a>
      <a href="/item.php?url=https%3A%2F%2Fperf.by%2Fproduct%2Fperforator-crh-1810-0329266&owner_id=2">Перфоратор CRH 1810</a>
      <a href="/to.php?url=https%3A%2F%2Fperf.by%2Fproduct%2Fperforator-crh-1810-kit">ещё</a>
      <a href="/to.php?url=https%3A%2F%2Fgost.by%2Fproduct%2Fwortex-crh-1810">наш</a>
      <a href="/to.php?url=https%3A%2F%2Fmirtehniki.by%2Fwortex-crh-1822%2F">другая модель</a>`;
    const links = pickResultLinks(html, 'https://shop.by/find/?findtext=x', q, {
      skipHosts: new Set(['gost.by']),
    });
    expect(links.own).toEqual([]);
    expect(links.shops.sort()).toEqual([
      'https://mirtehniki.by/wortex/wortex-crh-1810-all1-solo/',
      'https://perf.by/product/perforator-crh-1810-0329266',
    ]);
  });

  it('without a code, most of the name must be in the link', () => {
    const fq = competitorQuery('Фитинг для пластиковых трубок с регулятором')!;
    const html = `
      <a href="/p/1">Фитинг для пластиковой трубки с регулятором 8 мм</a>
      <a href="/p/2">Фитинг латунный</a>`;
    expect(
      pickResultLinks(html, 'https://shop.example/search?q=x', fq).own,
    ).toEqual(['https://shop.example/p/1']);
  });
});

describe('parseCompetitors', () => {
  it('one site per line, name optional, {q} required', () => {
    expect(
      parseCompetitors(
        '21vek https://www.21vek.by/search/?term={q}\n\nhttps://shop.by/find/?findtext={q}',
      ),
    ).toEqual([
      { name: '21vek', search: 'https://www.21vek.by/search/?term={q}' },
      { name: 'shop.by', search: 'https://shop.by/find/?findtext={q}' },
    ]);
    expect(() => parseCompetitors('https://shop.by/find/')).toThrow(/\{q\}/);
  });

  it('squash meets spellings of one code', () => {
    expect(squash('CRH-1810')).toBe(squash('crh 1810'));
  });
});
