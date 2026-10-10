import {
  isPlaceholderImageUrl,
  withoutPlaceholderImages,
} from './product-images';

describe('isPlaceholderImageUrl', () => {
  it.each([
    'https://th-tool.by/wa-data/public/site/themes/insales/img/default.png?v1715866486',
    'https://th-tool.by/wa-data/public/site/themes/insales/img/DEFAULT.PNG',
    'https://example.by/img/no_photo.jpg',
  ])('recognises the supplier placeholder %s', (url) => {
    expect(isPlaceholderImageUrl(url)).toBe(true);
  });

  it.each([
    'https://th-tool.by/wa-data/public/shop/products/70/16/471670/images/6911245/6911245.970.webp',
    'https://content.tools.by/files/products/1234.750x0.jpg',
  ])('keeps a real product photo %s', (url) => {
    expect(isPlaceholderImageUrl(url)).toBe(false);
  });
});

describe('withoutPlaceholderImages', () => {
  it('drops the placeholder and keeps the order of the rest', () => {
    const images = [
      { url: 'https://th-tool.by/site/themes/insales/img/default.png' },
      { url: 'https://th-tool.by/shop/products/a.970.webp' },
      { url: 'https://th-tool.by/shop/products/b.970.webp' },
    ];

    expect(withoutPlaceholderImages(images)).toEqual([
      { url: 'https://th-tool.by/shop/products/a.970.webp' },
      { url: 'https://th-tool.by/shop/products/b.970.webp' },
    ]);
  });

  // "No photo" is what the storefront's own placeholder is for, and what the
  // admin data-quality report counts — a fallback here would hide both.
  it('returns nothing when the gallery held only a placeholder', () => {
    expect(
      withoutPlaceholderImages([
        { url: 'https://th-tool.by/site/themes/insales/img/default.png' },
      ]),
    ).toEqual([]);
  });
});
