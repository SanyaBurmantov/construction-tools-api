import { normalizeSearchTerm } from './search-term';
import { SearchLogService } from './search-log.service';

describe('normalizeSearchTerm', () => {
  it('folds case, ё, spaces and control characters', () => {
    expect(normalizeSearchTerm('  Бур  SDS\tПлюс  ')).toBe('бур sds плюс');
    expect(normalizeSearchTerm('Ёрш')).toBe('ерш');
  });
  it('drops what is not worth a row', () => {
    expect(normalizeSearchTerm('a')).toBe('');
    expect(normalizeSearchTerm('   ')).toBe('');
    expect(normalizeSearchTerm(42)).toBe('');
  });
  it('caps the length', () => {
    expect(normalizeSearchTerm('х'.repeat(500))).toHaveLength(120);
  });
});

describe('SearchLogService.record', () => {
  function build(repeat: object | null = null) {
    const prisma = {
      searchEvent: {
        findFirst: jest.fn().mockResolvedValue(repeat),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return { service: new SearchLogService(prisma as never), prisma };
  }

  it('stores a search with its result count and a hashed IP, never the IP', async () => {
    const { service, prisma } = build();
    await service.record(
      { kind: 'SEARCH', term: ' Перфоратор ', source: 'catalog', results: 12 },
      '203.0.113.7',
    );
    const data = prisma.searchEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      kind: 'SEARCH',
      term: 'перфоратор',
      results: 12,
      productId: null,
    });
    expect(data.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain('203.0.113.7');
  });

  it('skips the same search from the same visitor within the window', async () => {
    const { service, prisma } = build({ id: 'x' });
    await service.record(
      { kind: 'SEARCH', term: 'бур', source: 'catalog', results: 3 },
      '1.2.3.4',
    );
    expect(prisma.searchEvent.create).not.toHaveBeenCalled();
  });

  it('always stores a click, with the product and position', async () => {
    const { service, prisma } = build({ id: 'x' });
    await service.record(
      {
        kind: 'CLICK',
        term: 'бур',
        source: 'suggest',
        productId: '846eaddd-c36d-45c5-9fdc-9b1fbb430f71',
        position: 2,
      },
      '1.2.3.4',
    );
    expect(prisma.searchEvent.findFirst).not.toHaveBeenCalled();
    expect(prisma.searchEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: 'CLICK',
      position: 2,
      results: null,
    });
  });

  it('never throws on a failed write', async () => {
    const { service, prisma } = build();
    prisma.searchEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record(
        { kind: 'SEARCH', term: 'бур', source: 'catalog', results: 1 },
        '1.2.3.4',
      ),
    ).resolves.toBeUndefined();
  });
});
