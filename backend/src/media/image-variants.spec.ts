import sharp from 'sharp';
import {
  capOfVariant,
  capsFor,
  renderVariants,
  variantKey,
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
    expect(capsFor(2000)).toEqual([160, 320, 640, 1200]);
    expect(capsFor(1200)).toEqual([160, 320, 640, 1200]);
    expect(capsFor(750)).toEqual([160, 320, 640, 1200]);
    expect(capsFor(640)).toEqual([160, 320, 640]);
    expect(capsFor(300)).toEqual([160, 320]);
    expect(capsFor(90)).toEqual([160]);
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
    const variants = await renderVariants(await photo(900, 600));
    expect(variants.map((v) => v.cap)).toEqual([160, 320, 640, 1200]);
    const sizes = await Promise.all(
      variants.map(async (v) => {
        const meta = await sharp(v.body).metadata();
        expect(meta.format).toBe('webp');
        return [meta.width, meta.height];
      }),
    );
    expect(sizes).toEqual([
      [160, 107],
      [320, 213],
      [640, 427],
      [900, 600],
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
