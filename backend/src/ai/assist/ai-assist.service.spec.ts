import { AiSuggestionKind, AiSuggestionStatus } from '@prisma/client';
import { AiAssistService, ASSIST_ACTOR } from './ai-assist.service';

/** A SiteSetting table in memory + the bits of Prisma each test needs. */
function build(overrides: Record<string, unknown> = {}, answer?: unknown) {
  const settings = new Map<string, string>();
  const suggestions: Array<Record<string, unknown>> = [];
  const prisma: Record<string, any> = {
    siteSetting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          settings.has(where.key)
            ? { key: where.key, value: settings.get(where.key) }
            : null,
        ),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { key: string };
          create: { value: string };
        }) => {
          settings.set(where.key, create.value);
          return Promise.resolve({});
        },
      ),
    },
    aiSuggestion: {
      findMany: jest.fn(() => Promise.resolve([])),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(suggestions.find((row) => row.id === where.id) ?? null),
      ),
      upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => {
        suggestions.push({ id: `s${suggestions.length + 1}`, ...create });
        return Promise.resolve({});
      }),
      update: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
    },
    aiTask: { count: jest.fn(() => Promise.resolve(0)) },
    product: {
      findMany: jest.fn(() => Promise.resolve([])),
      findUnique: jest.fn(() => Promise.resolve(null)),
      update: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    category: {
      findUnique: jest.fn(() => Promise.resolve({ id: 'fallback' })),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    specification: { updateMany: jest.fn(() => Promise.resolve({ count: 2 })) },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    ...overrides,
  };
  const client = {
    enabled: true,
    defaultModel: 'deepseek-flash',
    chat: jest.fn(() =>
      Promise.resolve({
        model: 'deepseek-flash',
        usage: { promptTokens: 10, completionTokens: 5, cacheHitTokens: 0 },
        content: JSON.stringify(answer ?? { items: [] }),
      }),
    ),
  };
  const ai = {
    createTask: jest.fn(() =>
      Promise.resolve({ id: 't1', tasks: [{ id: 't1' }] }),
    ),
  };
  const service = new AiAssistService(
    prisma as never,
    client as never,
    ai as never,
    { findDuplicates: jest.fn(() => Promise.resolve([])) } as never,
    { enqueue: jest.fn(() => Promise.resolve()) } as never,
  );
  return { service, prisma, client, ai, settings, suggestions };
}

describe('AiAssistService.step', () => {
  it('does nothing while a job is switched off', async () => {
    const { service, client } = build();
    expect(await service.step('categorize')).toEqual({
      result: 'off',
      items: 0,
    });
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('stops at the daily limit', async () => {
    const { service, settings, client } = build();
    settings.set(
      'ai.assist.leads',
      JSON.stringify({ enabled: true, daily: 0 }),
    );
    expect((await service.step('leads')).result).toBe('limit');
    expect(client.chat).not.toHaveBeenCalled();
  });
});

describe('autopilot', () => {
  it('starts one AI task over the products no AI task has written', async () => {
    const { service, settings, prisma, ai } = build();
    settings.set(
      'ai.assist.autopilot',
      JSON.stringify({ enabled: true, daily: 2 }),
    );
    prisma.product.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

    const outcome = await service.step('autopilot');

    expect(outcome).toMatchObject({ result: 'done', items: 2 });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'PUBLISHED',
          NOT: {
            aiLockedFields: {
              hasSome: expect.arrayContaining(['descriptionFull']),
            },
          },
        },
        take: 2,
      }),
    );
    expect(ai.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'PRODUCT',
        templates: true,
        ids: ['p1', 'p2'],
        // The default template's per-field instructions.
        fieldPrompts: expect.objectContaining({
          seoDescription: expect.stringMatching(/безнал/),
        }),
      }),
      ASSIST_ACTOR,
    );
    // Counted against the day.
    expect(JSON.parse(settings.get('ai.assist.usage.autopilot')!).items).toBe(
      2,
    );
  });

  it('waits while its last task is still running', async () => {
    const { service, settings, prisma, ai } = build();
    settings.set('ai.assist.autopilot', JSON.stringify({ enabled: true }));
    prisma.aiTask.count.mockResolvedValue(1);
    expect((await service.step('autopilot')).result).toBe('idle');
    expect(ai.createTask).not.toHaveBeenCalled();
  });
});

describe('categorize', () => {
  const product = {
    id: 'p1',
    name: 'Анкер клиновой М10х100',
    brand: { name: 'STARFIX' },
    productSpecs: [],
  };

  function withCandidates(answer: unknown) {
    const ctx = build({}, answer);
    ctx.settings.set('ai.assist.categorize', JSON.stringify({ enabled: true }));
    ctx.prisma.product.findMany.mockResolvedValue([product]);
    ctx.prisma.$queryRaw
      .mockResolvedValueOnce([{ categoryId: 'c-anchor' }])
      .mockResolvedValueOnce([]);
    ctx.prisma.category.findMany.mockResolvedValue([
      {
        id: 'c-anchor',
        name: 'Анкеры',
        parent: { name: 'Крепёж', isVisible: true, parent: null },
      },
    ]);
    ctx.prisma.product.findUnique.mockResolvedValue({
      categoryId: 'fallback',
      aiLockedFields: [],
    });
    return ctx;
  }

  it('applies a confident pick and locks the category against the re-parse', async () => {
    const { service, prisma, suggestions } = withCandidates({
      items: [
        {
          id: 'p1',
          categoryId: 'c-anchor',
          confidence: 'high',
          reason: 'анкер',
        },
      ],
    });
    await service.step('categorize');
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { categoryId: 'c-anchor', aiLockedFields: ['categoryId'] },
    });
    expect(suggestions[0]).toMatchObject({
      kind: AiSuggestionKind.CATEGORY,
      key: 'p1',
      status: AiSuggestionStatus.APPLIED,
      auto: true,
    });
  });

  it('leaves an unsure pick for an admin', async () => {
    const { service, prisma, suggestions } = withCandidates({
      items: [{ id: 'p1', categoryId: 'c-anchor', confidence: 'low' }],
    });
    await service.step('categorize');
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(suggestions[0]).toMatchObject({
      status: AiSuggestionStatus.PENDING,
    });
  });
});

describe('applying proposals', () => {
  it('a synonym joins the search groups', async () => {
    const { service, settings, suggestions } = build();
    settings.set('search.synonyms', JSON.stringify([['болт', 'винт']]));
    suggestions.push({
      id: 'x',
      kind: AiSuggestionKind.SYNONYM,
      status: AiSuggestionStatus.PENDING,
      payload: { term: 'шурик', group: ['шурик', 'шуруповерт'] },
    });
    await service.apply('x', 'admin');
    expect(JSON.parse(settings.get('search.synonyms')!)).toEqual([
      ['болт', 'винт'],
      ['шурик', 'шуруповерт'],
    ]);
  });

  it('a spec fold is stored for the normalizer and applied to the facets at once', async () => {
    const { service, settings, suggestions, prisma } = build();
    suggestions.push({
      id: 'x',
      kind: AiSuggestionKind.SPEC_MERGE,
      status: AiSuggestionStatus.PENDING,
      payload: {
        keys: ['moshchnost-potreblyaemaya~w', 'moshchnost~w'],
        into: 'moshchnost~w',
        name: 'Мощность',
      },
    });
    await service.apply('x', 'admin');
    expect(JSON.parse(settings.get('spec.aliases')!)).toEqual({
      'moshchnost-potreblyaemaya~w': { key: 'moshchnost~w', name: 'Мощность' },
    });
    expect(prisma.specification.updateMany).toHaveBeenCalledWith({
      where: {
        canonicalKey: { in: ['moshchnost-potreblyaemaya~w', 'moshchnost~w'] },
      },
      data: { canonicalKey: 'moshchnost~w', canonicalName: 'Мощность' },
    });
  });

  it('a decided proposal cannot be applied twice', async () => {
    const { service, suggestions } = build();
    suggestions.push({
      id: 'x',
      kind: AiSuggestionKind.SYNONYM,
      status: AiSuggestionStatus.REJECTED,
      payload: {},
    });
    await expect(service.apply('x', 'admin')).rejects.toThrow('рассмотрено');
  });

  it('a variant revert clears only the line it wrote', async () => {
    const { service, suggestions, prisma } = build();
    suggestions.push({
      id: 'x',
      kind: AiSuggestionKind.VARIANT,
      status: AiSuggestionStatus.APPLIED,
      payload: {
        line: 'Сверло Bosch',
        members: [
          { id: 'a', label: '6 мм' },
          { id: 'b', label: '8 мм' },
        ],
      },
    });
    await service.revert('x', 'admin');
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, variantLine: 'Сверло Bosch' },
      data: {
        variantLine: null,
        variantLabel: null,
        contentUpdatedAt: expect.any(Date),
      },
    });
  });
});

describe('placing an unplaced product by hand', () => {
  it('works from a proposal the job itself rejected, with any category', async () => {
    const { service, suggestions, prisma } = build();
    suggestions.push({
      id: 'x',
      kind: AiSuggestionKind.CATEGORY,
      status: AiSuggestionStatus.REJECTED,
      payload: { productId: 'p1', from: 'fallback', to: null, candidates: [] },
    });
    prisma.category.findUnique.mockResolvedValue({ id: 'c-any' });
    prisma.product.findUnique.mockResolvedValue({
      categoryId: 'fallback',
      aiLockedFields: [],
    });
    await service.apply('x', 'admin', { categoryId: 'c-any' });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { categoryId: 'c-any', aiLockedFields: ['categoryId'] },
    });
  });
});
