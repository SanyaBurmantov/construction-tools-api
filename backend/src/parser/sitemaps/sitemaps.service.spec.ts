import { isThToolsProductUrl } from './sitemaps.service';

describe('isThToolsProductUrl', () => {
  it('keeps flat product pages', () => {
    expect(
      isThToolsProductUrl('https://th-tool.by/manzhety-dlya-t90204/'),
    ).toBe(true);
    expect(
      isThToolsProductUrl(
        'https://th-tool.by/sharoshka-sfericheskaya-vytyanutaya-po-metallu-8mm/',
      ),
    ).toBe(true);
  });

  it('drops category pages', () => {
    // ~710 of these were queued and then fetched over HTTP just to be SKIPPED.
    expect(isThToolsProductUrl('https://th-tool.by/category/aksessuary/')).toBe(
      false,
    );
    expect(
      isThToolsProductUrl('https://th-tool.by/category/aksessuary/avtolampy/'),
    ).toBe(false);
  });

  it('drops the home page and static pages', () => {
    expect(isThToolsProductUrl('https://th-tool.by/')).toBe(false);
    expect(isThToolsProductUrl('https://th-tool.by/o-nas/')).toBe(false);
    expect(isThToolsProductUrl('https://th-tool.by/dealers/')).toBe(false);
  });

  it('drops anything that is not a valid URL', () => {
    expect(isThToolsProductUrl('not-a-url')).toBe(false);
  });
});
