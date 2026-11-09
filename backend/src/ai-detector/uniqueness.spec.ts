import { containsPattern, searchPhrases, uniqueness } from './uniqueness';

const supplier =
  'Аккумуляторный перфоратор предназначен для сверления отверстий в бетоне, кирпиче и камне. ' +
  'Бесщеточный двигатель обеспечивает высокую производительность и долгий срок службы. ' +
  'Прорезиненная рукоятка снижает вибрацию при длительной работе.';

describe('uniqueness', () => {
  it('a verbatim copy is 0% unique and names its source', () => {
    const result = uniqueness(supplier, [
      { text: supplier, meta: { id: 's' } },
    ]);
    expect(result.percent).toBe(0);
    expect(result.sources).toEqual([{ id: 's', share: 100 }]);
    expect(result.spans).toHaveLength(1);
    expect(supplier.slice(result.spans[0].start, result.spans[0].end)).toMatch(
      /^Аккумуляторный.*работе$/s,
    );
  });

  it('ignores case, ё and punctuation, and finds a copied sentence inside a new text', () => {
    const ours =
      'Перфоратор BULL BH 1801 — для дачи и ремонта квартиры. ' +
      'БЕСЩЁТОЧНЫЙ двигатель, обеспечивает высокую производительность и долгий срок службы! ' +
      'В комплекте кейс, два аккумулятора по 4 А·ч и зарядное устройство.';
    const result = uniqueness(ours, [{ text: supplier, meta: { id: 's' } }]);
    expect(result.percent).toBeGreaterThan(40);
    expect(result.percent).toBeLessThan(90);
    const copied = result.spans.map((s) => ours.slice(s.start, s.end));
    expect(copied).toEqual([
      'БЕСЩЁТОЧНЫЙ двигатель, обеспечивает высокую производительность и долгий срок службы',
    ]);
  });

  it('a rewritten text is unique; unrelated sources are dropped', () => {
    const rewritten =
      'Перфоратор на аккумуляторе пробивает бетон и кирпич, мотор без щёток служит дольше, ' +
      'а мягкая ручка гасит отдачу.';
    const result = uniqueness(rewritten, [
      { text: supplier, meta: { id: 's' } },
      { text: 'Совсем другой текст про садовые ножницы.', meta: { id: 'x' } },
    ]);
    expect(result.percent).toBe(100);
    expect(result.sources).toEqual([]);
  });

  it('ranks sources by share and points spans at the ranking', () => {
    const half = supplier.split('. ')[0];
    const result = uniqueness(supplier, [
      { text: half, meta: { id: 'half' } },
      { text: supplier, meta: { id: 'full' } },
    ]);
    expect(result.sources.map((s) => s.id)).toEqual(['full', 'half']);
    expect(result.spans[0].sources).toEqual([0, 1]);
  });

  it('too short to shingle → no verdict', () => {
    expect(uniqueness('Дрель ударная', []).percent).toBeNull();
  });
});

describe('searchPhrases', () => {
  it('takes verbatim five-word runs, spread over the text', () => {
    const phrases = searchPhrases(supplier.repeat(3), 4);
    expect(phrases).toHaveLength(4);
    for (const p of phrases) {
      expect(supplier.repeat(3)).toContain(p);
      expect(p.split(' ')).toHaveLength(5);
    }
  });

  it('skips runs of short function words', () => {
    expect(searchPhrases('и в на по за до и в на по за до')).toEqual([]);
  });
});

describe('containsPattern', () => {
  it('escapes LIKE wildcards', () => {
    expect(containsPattern('100% _хлопок_ a\\b')).toBe(
      '%100\\% \\_хлопок\\_ a\\\\b%',
    );
  });
});
