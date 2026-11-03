import sharp from 'sharp';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';
import { S3Client } from '../common/utils/s3-client';
import { ImageMirrorService } from './image-mirror.service';
import { variantKey } from './image-variants';

jest.mock('../common/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));
jest.mock('../common/utils/process-role', () => ({
  runsBackgroundJobs: () => true,
}));

const fetchMock = fetchWithTimeout as jest.MockedFunction<
  typeof fetchWithTimeout
>;
const BASE = 'https://s3.test/gost-by-media';

/** A bucket in memory: key → bytes. */
function fakeS3(objects = new Map<string, Buffer>()) {
  jest.spyOn(S3Client.prototype, 'ensureBucket').mockResolvedValue(undefined);
  jest
    .spyOn(S3Client.prototype, 'putBucketPolicy')
    .mockResolvedValue(undefined);
  jest
    .spyOn(S3Client.prototype, 'headObject')
    .mockImplementation((_bucket, key) =>
      Promise.resolve(objects.get(key)?.length ?? null),
    );
  const puts: string[] = [];
  jest
    .spyOn(S3Client.prototype, 'putObject')
    .mockImplementation((_bucket, key, body) => {
      puts.push(key);
      objects.set(key, body);
      return Promise.resolve();
    });
  return { objects, puts };
}

function fakePrisma(candidates: Array<{ url: string; mirrored: boolean }>) {
  const mirrors = new Map<string, Record<string, unknown>>();
  const relinks: Array<{ sourceUrl: string; url: string }> = [];
  const prisma = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('sum(bytes)')) return Promise.resolve([{ bytes: 0n }]);
      return Promise.resolve(candidates);
    }),
    imageMirror: {
      findUnique: jest.fn(({ where }: { where: { sourceUrl: string } }) =>
        Promise.resolve(mirrors.get(where.sourceUrl) ?? null),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { sourceUrl: string };
          create: Record<string, unknown>;
        }) => {
          mirrors.set(where.sourceUrl, {
            ...mirrors.get(where.sourceUrl),
            ...create,
          });
          return Promise.resolve();
        },
      ),
    },
    productImage: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { sourceUrl: string };
          data: { url: string };
        }) => {
          relinks.push({ sourceUrl: where.sourceUrl, url: data.url });
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };
  return { prisma, mirrors, relinks };
}

function service(prisma: unknown) {
  const telegram = {
    notifyParserProblem: jest.fn().mockResolvedValue(undefined),
  };
  return new ImageMirrorService(prisma as never, telegram as never);
}

const okResponse = (body: Buffer) =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: () =>
      Promise.resolve(
        body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
      ),
  }) as unknown as Response;

describe('ImageMirrorService.tick', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.S3_ENDPOINT = 'https://s3.test';
    process.env.S3_ACCESS_KEY = 'k';
    process.env.S3_SECRET_KEY = 's';
    process.env.S3_MEDIA_BUCKET = 'gost-by-media';
    delete process.env.S3_MEDIA_PUBLIC_BASE;
    fetchMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('downloads a new photo once, stores its sizes smallest first and points the rows at the largest', async () => {
    const url = 'https://dukon.by/upload/iblock/a/photo.jpg';
    const photo = await sharp({
      create: { width: 900, height: 700, channels: 3, background: '#c33' },
    })
      .jpeg()
      .toBuffer();
    fetchMock.mockResolvedValue(okResponse(photo));
    const { puts } = fakeS3();
    const { prisma, mirrors, relinks } = fakePrisma([{ url, mirrored: false }]);

    const counts = await service(prisma).tick();

    expect(counts?.stored).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(puts).toEqual(
      [160, 320, 640, 1200].map((cap) => variantKey(url, cap)),
    );
    expect(mirrors.get(url)).toMatchObject({
      status: 'STORED',
      key: variantKey(url, 1200),
      contentType: 'image/webp',
    });
    expect(relinks).toEqual([
      { sourceUrl: url, url: `${BASE}/${variantKey(url, 1200)}` },
    ]);
  });

  it('finds a photo already in the bucket by its largest size and never asks the supplier', async () => {
    const url = 'https://content.tools.by/images/1.jpg';
    const objects = new Map([
      [variantKey(url, 160), Buffer.alloc(10)],
      [variantKey(url, 320), Buffer.alloc(20)],
    ]);
    fakeS3(objects);
    const { prisma, mirrors, relinks } = fakePrisma([{ url, mirrored: false }]);

    const counts = await service(prisma).tick();

    expect(counts?.stored).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mirrors.get(url)).toMatchObject({ key: variantKey(url, 320) });
    expect(relinks[0].url).toBe(`${BASE}/${variantKey(url, 320)}`);
  });

  it('marks a 404 and an HTML page as failed and stores nothing', async () => {
    const gone = 'https://dukon.by/upload/gone.jpg';
    const html = 'https://dukon.by/upload/html.jpg';
    fetchMock.mockImplementation((u) =>
      Promise.resolve(
        u === gone
          ? ({ ok: false, status: 404 } as Response)
          : okResponse(Buffer.from('<html><body>нет фото</body></html>')),
      ),
    );
    const { puts } = fakeS3();
    const { prisma, mirrors, relinks } = fakePrisma([
      { url: gone, mirrored: false },
      { url: html, mirrored: false },
    ]);

    const counts = await service(prisma).tick();

    expect(counts?.failed).toBe(2);
    expect(puts).toEqual([]);
    expect(relinks).toEqual([]);
    expect(mirrors.get(gone)).toMatchObject({
      status: 'FAILED',
      error: 'HTTP 404',
    });
    expect(mirrors.get(html)).toMatchObject({
      status: 'FAILED',
      error: 'not an image',
    });
  });

  it('does nothing without the S3 settings', async () => {
    delete process.env.S3_MEDIA_BUCKET;
    const { prisma } = fakePrisma([]);
    expect(await service(prisma).tick()).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('ImageMirrorService candidate walk', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.S3_ENDPOINT = 'https://s3.test';
    process.env.S3_ACCESS_KEY = 'k';
    process.env.S3_SECRET_KEY = 's';
    process.env.S3_MEDIA_BUCKET = 'gost-by-media';
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('continues from where the last tick stopped, starts over at the end, rests after an empty pass', async () => {
    fakeS3(new Map());
    const cursors: unknown[] = [];
    const pages: Array<Array<{ url: string; mirrored: boolean }>> = [
      Array.from({ length: 40 }, (_, i) => ({
        url: `https://a.by/${String(i).padStart(2, '0')}.jpg`,
        mirrored: true,
      })),
      [{ url: 'https://a.by/99.jpg', mirrored: true }],
      [],
    ];
    const prisma = {
      $queryRaw: jest.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join('?').includes('sum(bytes)')) {
            return Promise.resolve([{ bytes: 0n }]);
          }
          cursors.push(values[0]);
          return Promise.resolve(pages.shift() ?? []);
        },
      ),
      imageMirror: {
        findUnique: jest.fn().mockResolvedValue({ key: 'v/aa/x/320.webp' }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      productImage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const mirror = new ImageMirrorService(
      prisma as never,
      {
        notifyParserProblem: jest.fn(),
      } as never,
    );

    await mirror.tick(); // full page → cursor at its last URL
    await mirror.tick(); // short page → end of the table, back to the start
    await mirror.tick(); // nothing from the start → rest
    await mirror.tick(); // resting: no query at all

    expect(cursors).toEqual(['', 'https://a.by/39.jpg', '']);
  });
});
