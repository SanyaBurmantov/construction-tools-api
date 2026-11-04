import {
  buildCategorizeMessages,
  parseCategorizeAnswer,
  parseDuplicateAnswer,
  parseLandingAnswer,
  parseLeadAnswer,
  parseSpecAnswer,
  parseSynonymAnswer,
  parseVariantAnswer,
} from './assist-prompts';
import { mergeJobSettings, assistDay } from './assist-jobs';

const answer = (items: unknown[]) => JSON.stringify({ items });

describe('categorize', () => {
  const items = [
    {
      id: 'p1',
      name: 'Анкер клиновой М10х100',
      brand: 'STARFIX',
      specs: [],
      candidates: [
        { id: 'c-anchor', path: 'Крепёж / Анкеры' },
        { id: 'c-bolt', path: 'Крепёж / Болты' },
      ],
    },
  ];

  it('sends the candidates and asks for one of them', () => {
    const [system, user] = buildCategorizeMessages(items);
    expect(system.content).toMatch(/только из candidates/);
    expect(user.content).toMatch(/c-anchor/);
  });

  it('accepts a candidate, confident only on «high»', () => {
    expect(
      parseCategorizeAnswer(
        answer([
          {
            id: 'p1',
            categoryId: 'c-anchor',
            confidence: 'high',
            reason: 'анкер',
          },
        ]),
        items,
      ).get('p1'),
    ).toEqual({ categoryId: 'c-anchor', confident: true, reason: 'анкер' });
    expect(
      parseCategorizeAnswer(
        answer([{ id: 'p1', categoryId: 'c-bolt', confidence: 'low' }]),
        items,
      ).get('p1')?.confident,
    ).toBe(false);
  });

  it('a category outside the candidates is no choice at all', () => {
    expect(
      parseCategorizeAnswer(
        answer([{ id: 'p1', categoryId: 'made-up', confidence: 'high' }]),
        items,
      ).get('p1'),
    ).toEqual({ categoryId: null, confident: false, reason: '' });
  });

  it('ignores ids it was not asked about', () => {
    expect(
      parseCategorizeAnswer(
        answer([{ id: 'other', categoryId: 'c-anchor' }]),
        items,
      ).size,
    ).toBe(0);
  });
});

describe('synonyms', () => {
  const terms = [
    { id: 't1', term: 'шурик', searches: 4 },
    { id: 't2', term: 'qwerty', searches: 2 },
  ];

  it('keeps a clean group that fires for the term', () => {
    expect(
      parseSynonymAnswer(
        answer([
          { id: 't1', group: ['шурик', 'Шуруповёрт'] },
          { id: 't2', group: null },
        ]),
        terms,
      ),
    ).toEqual([{ term: 'шурик', group: ['шурик', 'шуруповерт'] }]);
  });

  it('drops a group none of whose stems the term starts with', () => {
    expect(
      parseSynonymAnswer(
        answer([{ id: 't1', group: ['дрель', 'перфоратор'] }]),
        terms,
      ),
    ).toEqual([]);
  });

  it('drops tsquery syntax and one-word groups', () => {
    expect(
      parseSynonymAnswer(
        answer([{ id: 't1', group: ['шурик:*|', 'x'] }]),
        terms,
      ),
    ).toEqual([]);
  });
});

describe('lead drafts', () => {
  const candidates = [
    { id: 'a', name: 'Перфоратор X', brand: 'X', inStock: true },
    { id: 'b', name: 'Перфоратор Y', brand: 'Y', inStock: false },
  ];

  it('keeps the text and only candidate ids', () => {
    expect(
      parseLeadAnswer(
        answer([
          {
            id: 'lead',
            text: 'Здравствуйте! Можем предложить перфоратор X как аналог.',
            productIds: ['a', 'zzz', 'a'],
          },
        ]),
        candidates,
      ),
    ).toEqual({
      text: 'Здравствуйте! Можем предложить перфоратор X как аналог.',
      productIds: ['a'],
    });
  });

  it('no draft from an empty answer', () => {
    expect(
      parseLeadAnswer(answer([{ id: 'lead', text: 'ок' }]), candidates),
    ).toBeNull();
    expect(parseLeadAnswer(answer([]), candidates)).toBeNull();
  });
});

describe('spec merges', () => {
  const specs = [
    {
      key: 'moshchnost~w',
      name: 'Мощность',
      unit: 'Вт',
      products: 300,
      samples: ['800'],
    },
    {
      key: 'moshchnost-potreblyaemaya~w',
      name: 'Потребляемая мощность',
      unit: 'Вт',
      products: 40,
      samples: ['750'],
    },
    {
      key: 'dlina~mm',
      name: 'Длина',
      unit: 'мм',
      products: 50,
      samples: ['100'],
    },
    { key: 'dlina~m', name: 'Длина', unit: 'м', products: 20, samples: ['2'] },
    {
      key: 'artikul',
      name: 'Артикул',
      unit: null,
      products: 300,
      samples: ['A1'],
    },
    { key: 'kod', name: 'Код', unit: null, products: 300, samples: ['1'] },
  ];

  it('folds into the most used key, with the given name', () => {
    expect(
      parseSpecAnswer(
        answer([
          {
            id: 'g1',
            keys: ['moshchnost-potreblyaemaya~w', 'moshchnost~w'],
            name: 'Мощность',
          },
        ]),
        specs,
      ),
    ).toEqual([
      {
        keys: ['moshchnost-potreblyaemaya~w', 'moshchnost~w'],
        into: 'moshchnost~w',
        name: 'Мощность',
      },
    ]);
  });

  it('refuses mixed units, identity specs, unknown keys and reused keys', () => {
    expect(
      parseSpecAnswer(
        answer([
          { id: 'g1', keys: ['dlina~mm', 'dlina~m'], name: 'Длина' },
          { id: 'g2', keys: ['artikul', 'kod'], name: 'Артикул' },
          { id: 'g3', keys: ['made-up', 'moshchnost~w'], name: 'X' },
        ]),
        specs,
      ),
    ).toEqual([]);
  });
});

describe('duplicates', () => {
  it('reads the three verdicts, nothing else', () => {
    const groups = [
      { id: 'g1', products: [] },
      { id: 'g2', products: [] },
    ];
    const verdicts = parseDuplicateAnswer(
      answer([
        { id: 'g1', verdict: 'different', reason: 'разный диаметр' },
        { id: 'g2', verdict: 'maybe' },
        { id: 'g3', verdict: 'same' },
      ]),
      groups,
    );
    expect([...verdicts]).toEqual([
      ['g1', { verdict: 'different', reason: 'разный диаметр' }],
    ]);
  });
});

describe('landings', () => {
  const items = [
    {
      id: 'b1:c1',
      brand: 'Makita',
      category: 'Перфораторы',
      path: 'Электроинструмент / Перфораторы',
      productCount: 12,
      examples: ['Перфоратор Makita HR2470', 'Перфоратор Makita HR2630'],
    },
  ];
  const good = {
    id: 'b1:c1',
    h1: 'Перфораторы Makita',
    description:
      'В каталоге собраны перфораторы Makita для сверления и долбления бетона, кирпича и камня: модели для монтажа, ремонта и строительных бригад.\n\nПодходят строительным и монтажным организациям, а также мастерам, которым нужен надёжный инструмент для ежедневной работы.',
    seoTitle: 'Перфораторы Makita для профессионалов',
    seoDescription:
      'Перфораторы Makita для бетона и кирпича. Доставка по Беларуси, оплата по безналу для организаций.',
  };

  it('passes a clean answer', () => {
    expect(
      parseLandingAnswer(answer([good]), items).get('b1:c1')?.rejected,
    ).toEqual({});
  });

  it('runs the AI task checks and the heading rules', () => {
    const result = parseLandingAnswer(
      answer([
        {
          ...good,
          h1: 'Перфораторы купить',
          seoDescription:
            'Перфораторы Makita с гарантией 3 года. Доставка по Беларуси, оплата по безналу.',
        },
      ]),
      items,
    ).get('b1:c1')!;
    expect(result.rejected.h1).toMatch(/бренда/);
    expect(result.rejected.seoDescription).toBeTruthy();
  });
});

describe('variants', () => {
  const products = [
    { id: 'a', name: 'Сверло по металлу HSS-G Bosch 6 мм' },
    { id: 'b', name: 'Сверло по металлу HSS-G Bosch 8 мм' },
    { id: 'c', name: 'Сверло по бетону Bosch 8 мм' },
  ];

  it('keeps a group whose labels are sizes from the names', () => {
    expect(
      parseVariantAnswer(
        answer([
          {
            id: 'g1',
            line: 'Сверло по металлу HSS-G Bosch',
            members: [
              { id: 'a', label: '6 мм' },
              { id: 'b', label: '8 мм' },
            ],
          },
        ]),
        products,
      ),
    ).toEqual([
      {
        line: 'Сверло по металлу HSS-G Bosch',
        members: [
          { id: 'a', label: '6 мм' },
          { id: 'b', label: '8 мм' },
        ],
      },
    ]);
  });

  it('drops a label with a number the name does not have, and then the group', () => {
    expect(
      parseVariantAnswer(
        answer([
          {
            id: 'g1',
            line: 'Сверло Bosch',
            members: [
              { id: 'a', label: '10 мм' },
              { id: 'b', label: '8 мм' },
            ],
          },
        ]),
        products,
      ),
    ).toEqual([]);
  });

  it('a product sits in one group only; equal labels are no switch', () => {
    expect(
      parseVariantAnswer(
        answer([
          {
            id: 'g1',
            line: 'Сверло Bosch',
            members: [
              { id: 'b', label: '8 мм' },
              { id: 'c', label: '8 мм' },
            ],
          },
        ]),
        products,
      ),
    ).toEqual([]);
  });
});

describe('job settings', () => {
  it('everything is off until switched on', () => {
    expect(mergeJobSettings('landings', undefined)).toEqual({
      enabled: false,
      daily: 60,
    });
    expect(
      mergeJobSettings('autopilot', { enabled: true, daily: '50' }),
    ).toMatchObject({
      enabled: true,
      daily: 50,
      template: 'preset:product-full-b2b',
    });
    expect(mergeJobSettings('leads', { daily: -3 }).daily).toBe(50);
  });

  it('counts the day in Minsk time', () => {
    expect(assistDay(new Date('2026-11-04T22:30:00Z'))).toBe('2026-11-05');
  });
});
