import {
  imageSourcesOf,
  isMirrorable,
  mediaConfigFromEnv,
  sniffImageType,
  withImageSources,
} from './image-mirror';

describe('isMirrorable', () => {
  it('takes supplier photos and leaves placeholders and junk alone', () => {
    expect(isMirrorable('https://content.tools.by/images/1.jpg')).toBe(true);
    expect(
      isMirrorable(
        'https://th-tool.by/wa-data/public/site/themes/x/img/default.png',
      ),
    ).toBe(false);
    expect(isMirrorable('/local/img.jpg')).toBe(false);
    expect(isMirrorable('data:image/png;base64,xx')).toBe(false);
  });
});

describe('sniffImageType', () => {
  const pad = (bytes: number[]) =>
    Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
  it('recognises the formats suppliers serve', () => {
    expect(sniffImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(sniffImageType(Buffer.from('GIF89a........'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it('refuses an HTML page served with 200', () => {
    expect(sniffImageType(Buffer.from('<!DOCTYPE html><html>…'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(3))).toBeNull();
  });
});

describe('withImageSources', () => {
  const stored = (url: string) =>
    url === 'https://s.by/1.jpg'
      ? 'https://s3/gost-by-media/p/aa/x.jpg'
      : undefined;

  it('points mirrored rows at our copy and records the source', () => {
    const out = withImageSources(
      {
        deleteMany: {},
        create: [
          { url: 'https://s.by/1.jpg', alt: 'a', order: 0 },
          { url: 'https://s.by/2.jpg', alt: 'a', order: 1 },
        ],
      },
      stored,
    );
    expect(out).toEqual({
      deleteMany: {},
      create: [
        {
          url: 'https://s3/gost-by-media/p/aa/x.jpg',
          sourceUrl: 'https://s.by/1.jpg',
          alt: 'a',
          order: 0,
        },
        {
          url: 'https://s.by/2.jpg',
          sourceUrl: 'https://s.by/2.jpg',
          alt: 'a',
          order: 1,
        },
      ],
    });
  });

  it('leaves a write without created images untouched', () => {
    const deleteOnly = { deleteMany: { OR: [] } };
    expect(withImageSources(deleteOnly, stored)).toBe(deleteOnly);
    expect(withImageSources(undefined, stored)).toBeUndefined();
  });

  it('lists the supplier URLs of a write', () => {
    expect(
      imageSourcesOf({ create: [{ url: 'a' }, { url: 'b', sourceUrl: 'c' }] }),
    ).toEqual(['a', 'c']);
    expect(imageSourcesOf({ deleteMany: {} })).toEqual([]);
  });
});

describe('mediaConfigFromEnv', () => {
  it('needs a bucket and an endpoint, and derives the public base', () => {
    expect(mediaConfigFromEnv({ S3_ENDPOINT: 'https://s3.by' })).toBeNull();
    expect(
      mediaConfigFromEnv({
        S3_ENDPOINT: 'https://s3.by/',
        S3_MEDIA_BUCKET: 'media',
      }),
    ).toEqual({
      bucket: 'media',
      publicBase: 'https://s3.by/media',
      maxBytes: 30 * 1024 ** 3,
    });
    expect(
      mediaConfigFromEnv({
        S3_ENDPOINT: 'https://s3.by',
        S3_MEDIA_BUCKET: 'media',
        S3_MEDIA_PUBLIC_BASE: 'https://gost.by/media/',
        S3_MEDIA_MAX_GB: '10',
      }),
    ).toEqual({
      bucket: 'media',
      publicBase: 'https://gost.by/media',
      maxBytes: 10 * 1024 ** 3,
    });
  });
});
