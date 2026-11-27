import { S3Client } from '../common/utils/s3-client';
import { MEDIA_SLIM_CURSOR_KEY, MediaSlimService } from './media-slim.service';

jest.mock('../common/utils/process-role', () => ({
  runsBackgroundJobs: () => true,
}));

const BASE = 'https://s3.test/gost-by-media';
const setOf = (n: number) =>
  `v/${n.toString(16).padStart(2, '0')}/${n.toString(16).padStart(40, '0')}/`;

function fakePrisma(rows: Array<{ sourceUrl: string; key: string }>) {
  const settings = new Map<string, string>();
  const log: string[] = [];
  const executed: Array<{ sql: string; values: unknown[] }> = [];
  const prisma = {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const cursor = values[0] as string;
        return Promise.resolve(rows.filter((r) => r.sourceUrl > cursor));
      },
    ),
    $executeRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const table = /UPDATE "(\w+)"/.exec(sql)![1];
        log.push(`update ${table}`);
        executed.push({ sql, values });
        return Promise.resolve(1);
      },
    ),
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
          log.push(`cursor ${update.value}`);
          settings.set(where.key, update.value);
          return Promise.resolve();
        },
      ),
    },
  };
  return { prisma, settings, log, executed };
}

function fakeS3(present: Set<string>, log: string[]) {
  jest
    .spyOn(S3Client.prototype, 'headObject')
    .mockImplementation((_b, key) =>
      Promise.resolve(present.has(key) ? 100 : null),
    );
  return jest
    .spyOn(S3Client.prototype, 'deleteObjects')
    .mockImplementation((_b, keys) => {
      log.push(`delete ${keys.length}`);
      return Promise.resolve([]);
    });
}

describe('MediaSlimService.step', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.S3_ENDPOINT = 'https://s3.test';
    process.env.S3_ACCESS_KEY = 'k';
    process.env.S3_SECRET_KEY = 's';
    process.env.S3_MEDIA_BUCKET = 'gost-by-media';
    delete process.env.S3_MEDIA_PUBLIC_BASE;
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('points the database at the 640 before deleting 160 and 1200, then moves the cursor', async () => {
    const a = setOf(1);
    const rows = [
      { sourceUrl: 'https://dukon.by/a.jpg', key: `${a}1200.webp` },
    ];
    const { prisma, log, executed, settings } = fakePrisma(rows);
    const del = fakeS3(new Set([`${a}320.webp`, `${a}640.webp`]), log);

    await new MediaSlimService(prisma as never).step();

    expect(log).toEqual([
      'update ImageMirror',
      'update ProductImage',
      'delete 2',
      'cursor https://dukon.by/a.jpg',
    ]);
    expect(del.mock.calls[0][1]).toEqual([`${a}160.webp`, `${a}1200.webp`]);
    expect(executed[0].values).toEqual([
      ['https://dukon.by/a.jpg'],
      [`${a}640.webp`],
      [200],
    ]);
    expect(executed[1].values).toEqual([
      ['https://dukon.by/a.jpg'],
      [`${BASE}/${a}1200.webp`],
      [`${BASE}/${a}640.webp`],
    ]);
    expect(settings.get(MEDIA_SLIM_CURSOR_KEY)).toBe('https://dukon.by/a.jpg');
  });

  it('leaves a set whose 640 is missing, and a 160-only set, untouched', async () => {
    const a = setOf(1);
    const b = setOf(2);
    const rows = [
      { sourceUrl: 'https://dukon.by/a.jpg', key: `${a}1200.webp` },
      { sourceUrl: 'https://dukon.by/b.jpg', key: `${b}160.webp` },
    ];
    const { prisma, log, settings } = fakePrisma(rows);
    const del = fakeS3(new Set([`${a}320.webp`]), log);

    await new MediaSlimService(prisma as never).step();

    expect(del).not.toHaveBeenCalled();
    expect(log).toEqual(['cursor https://dukon.by/b.jpg']);
    expect(settings.get(MEDIA_SLIM_CURSOR_KEY)).toBe('https://dukon.by/b.jpg');
  });

  it('keeps the cursor when the delete fails, so the batch is done again', async () => {
    const a = setOf(1);
    const { prisma, settings, log } = fakePrisma([
      { sourceUrl: 'https://dukon.by/a.jpg', key: `${a}1200.webp` },
    ]);
    fakeS3(new Set([`${a}320.webp`, `${a}640.webp`]), log).mockRejectedValue(
      new Error('S3 delete: HTTP 503 SlowDownWrite'),
    );

    await expect(new MediaSlimService(prisma as never).step()).rejects.toThrow(
      'SlowDownWrite',
    );
    expect(settings.has(MEDIA_SLIM_CURSOR_KEY)).toBe(false);
  });

  it('at the end renames the copies of 1200 URLs and stops for good', async () => {
    const { prisma, settings, log } = fakePrisma([]);
    fakeS3(new Set(), log);
    const service = new MediaSlimService(prisma as never);

    expect(await service.step()).toBe(false);
    expect(log.slice(0, 3)).toEqual([
      'update ProductImage',
      'update OrderItem',
      'update Category',
    ]);
    expect(settings.get(MEDIA_SLIM_CURSOR_KEY)).toMatch(/^done:/);

    prisma.$queryRaw.mockClear();
    expect(await service.step()).toBe(false);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
