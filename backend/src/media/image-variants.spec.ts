import sharp from 'sharp';
import {
  capOfVariant,
  capsFor,
  renderVariants,
  storedCaps,
  variantKey,
  variantUrlFor,
} from './image-variants';

const photo = (width: number, height: number, alpha = false) =>
  sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha
        ? { r: 200, g: 40, b: 40, alpha: 0.5 }
        : { r: 200, g: 40, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();

describe('capsFor', () => {
  it('stops at the first cap that covers the photo', () => {
    expect(capsFor(2000)).toEqual([320, 640]);
    expect(capsFor(750)).toEqual([320, 640]);
    expect(capsFor(640)).toEqual([320, 640]);
    expect(capsFor(300)).toEqual([320]);
    expect(capsFor(90)).toEqual([320]);
  });
});

describe('storedCaps / variantUrlFor', () => {
  const base = 'https://s3.example/gost-by-media/v/ab/' + 'a'.repeat(40);

  it('knows which files a set has, old four-size sets included', () => {
    expect(storedCaps(640)).toEqual([320, 640]);
    expect(storedCaps(320)).toEqual([320]);
    // 1200 and 160 of the old sets are deleted; 640 is their largest now.
    expect(storedCaps(1200)).toEqual([320, 640]);
    // An original under 160 px kept its single file.
    expect(storedCaps(160)).toEqual([160]);
  });

  it('never points at a deleted 160 or 1200', () => {
    expect(variantUrlFor(`${base}/1200.webp`, 112)).toBe(`${base}/320.webp`);
    expect(variantUrlFor(`${base}/1200.webp`, 960)).toBe(`${base}/640.webp`);
    expect(variantUrlFor(`${base}/640.webp`, 600)).toBe(`${base}/640.webp`);
    expect(variantUrlFor(`${base}/320.webp`, 960)).toBe(`${base}/320.webp`);
    expect(variantUrlFor(`${base}/160.webp`, 320)).toBe(`${base}/160.webp`);
    expect(variantUrlFor('https://dukon.by/a.jpg', 320)).toBe(
      'https://dukon.by/a.jpg',
    );
  });
});

describe('variantKey / capOfVariant', () => {
  it('is stable per URL, sharded, and round-trips its cap', () => {
    const key = variantKey('https://dukon.by/upload/a.jpg', 640);
    expect(key).toMatch(/^v\/[0-9a-f]{2}\/[0-9a-f]{40}\/640\.webp$/);
    expect(key.slice(2, 4)).toBe(key.slice(5, 7));
    expect(variantKey('https://dukon.by/upload/a.jpg', 640)).toBe(key);
    expect(variantKey('https://dukon.by/upload/b.jpg', 640)).not.toBe(key);
    expect(capOfVariant(key)).toBe(640);
    expect(
      capOfVariant(`https://storage-1339.s3hoster.by/gost-by-media/${key}`),
    ).toBe(640);
    expect(capOfVariant('https://dukon.by/upload/a.jpg')).toBeNull();
  });
});

describe('renderVariants', () => {
  it('fits each cap inside the box, never enlarges, and writes WebP', async () => {
    const small = await renderVariants(await photo(200, 100));
    expect(small.map((v) => v.cap)).toEqual([320]);
    expect((await sharp(small[0].body).metadata()).width).toBe(200);

    const variants = await renderVariants(await photo(900, 600));
    expect(variants.map((v) => v.cap)).toEqual([320, 640]);
    const sizes = await Promise.all(
      variants.map(async (v) => {
        const meta = await sharp(v.body).metadata();
        expect(meta.format).toBe('webp');
        return [meta.width, meta.height];
      }),
    );
    expect(sizes).toEqual([
      [320, 213],
      [640, 427],
    ]);
  });

  it('keeps transparency', async () => {
    const png = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const [small] = await renderVariants(png);
    expect((await sharp(small.body).metadata()).hasAlpha).toBe(true);
  });

  it('throws on bytes that are not a picture', async () => {
    await expect(
      renderVariants(
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]),
      ),
    ).rejects.toThrow();
  });
});
