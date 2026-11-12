import {
  ProductTextCleanupService,
  TEXT_CLEANUP_CURSOR_KEY,
} from './product-text-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';
import { SUPPLIER_TEXT_RULE_VERSION } from './supplier-text';

const BLOCK =
  'Скамьи для раздевалок, гардеробных и подсобных помещений изготавливаются в общепромышленном и антистатическом исполнении. Ширина скамьи: 400 мм.';

type Row = {
  id: string;
  name: string;
  descriptionShort: string | null;
  descriptionFull: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  lockedFields: string[];
  aiLockedFields: string[];
};

function row(id: string, patch: Partial<Row> = {}): Row {
  return {
    id,
    name: `Товар ${id}`,
    descriptionShort: null,
    descriptionFull: 'Обычное описание товара.',
    seoTitle: null,
    seoDescription: null,
    lockedFields: [],
    aiLockedFields: [],
    ...patch,
  };
}

function setup(rows: Row[], cursor?: string) {
  const settings = new Map<string, string>();
  if (cursor !== undefined) settings.set(TEXT_CLEANUP_CURSOR_KEY, cursor);
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const idQueries: Array<Record<string, unknown>> = [];
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const prisma = {
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
          update,
        }: {
          where: { key: string };
          update: { value: string };
        }) => {
          settings.set(where.key, update.value);
          return Promise.resolve({});
        },
      ),
    },
    product: {
      findMany: jest.fn(
        (args: {
          where: { id: { gt: string } };
          take: number;
          select: Record<string, unknown>;
        }) => {
          idQueries.push(args.select);
          return Promise.resolve(
            sorted
              .filter((r) => r.id > args.where.id.gt)
              .slice(0, args.take)
              .map((r) => ({ id: r.id })),
          );
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          return Promise.resolve({});
        },
      ),
    },
  } as unknown as PrismaService;
  return {
    service: new ProductTextCleanupService(prisma),
    settings,
    updates,
    idQueries,
  };
}

describe('ProductTextCleanupService', () => {
  it('keys its cursor by the rule version', () => {
    expect(TEXT_CLEANUP_CURSOR_KEY).toBe(
      `productTextCleanup.cursor.v${SUPPLIER_TEXT_RULE_VERSION}`,
    );
  });

  it('collapses a repeated description, reading ids only in bulk', async () => {
    const { service, updates, settings, idQueries } = setup([
      row('a'),
      row('b', { descriptionFull: `${BLOCK} ${BLOCK} ${BLOCK}` }),
      row('c'),
    ]);

    expect(await service.run()).toEqual({ scanned: 3, updated: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('b');
    expect(updates[0].data.descriptionFull).toBe(BLOCK);
    expect(updates[0].data.contentUpdatedAt).toBeInstanceOf(Date);
    // Nothing but text (and its lastmod) is written: no price, no status.
    expect(Object.keys(updates[0].data).sort()).toEqual([
      'contentUpdatedAt',
      'descriptionFull',
    ]);
    for (const select of idQueries) expect(select).toEqual({ id: true });
    expect(settings.get(TEXT_CLEANUP_CURSOR_KEY)).toBe('done');
  });

  it('does not touch fields an admin or an AI task wrote', async () => {
    const repeated = `${BLOCK} ${BLOCK}`;
    const { service, updates } = setup([
      row('a', {
        descriptionFull: repeated,
        lockedFields: ['descriptionFull'],
      }),
      row('b', {
        descriptionFull: repeated,
        aiLockedFields: ['descriptionFull'],
      }),
      row('c', {
        descriptionFull: repeated,
        seoDescription: 'Купить скамью в Минске с гарантией и доставкой.',
        aiLockedFields: ['descriptionFull'],
      }),
    ]);

    await service.run();

    expect(updates.map((update) => update.id)).toEqual(['c']);
    expect(updates[0].data).not.toHaveProperty('descriptionFull');
    expect(updates[0].data.seoDescription).toBe('Товар c');
  });

  it('runs once per rule version and resumes from its cursor', async () => {
    const done = setup(
      [row('a', { descriptionFull: `${BLOCK} ${BLOCK}` })],
      'done',
    );
    expect(await done.service.run()).toEqual({
      scanned: 0,
      updated: 0,
      alreadyDone: true,
    });
    expect(done.updates).toEqual([]);

    const resumed = setup(
      [
        row('a', { descriptionFull: `${BLOCK} ${BLOCK}` }),
        row('b', { descriptionFull: `${BLOCK} ${BLOCK}` }),
      ],
      'a',
    );
    expect(await resumed.service.run()).toEqual({ scanned: 1, updated: 1 });
    expect(resumed.updates.map((u) => u.id)).toEqual(['b']);
  });

  it('shares one pass between the boot run and the nightly cron', async () => {
    const { service, updates } = setup([
      row('a', { descriptionFull: `${BLOCK} ${BLOCK}` }),
    ]);
    const [first, second] = await Promise.all([service.run(), service.run()]);
    expect(first).toBe(second);
    expect(updates).toHaveLength(1);
  });
});
