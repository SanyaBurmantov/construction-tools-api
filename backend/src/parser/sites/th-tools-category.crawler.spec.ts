import {
  isThToolsCategoryUrl,
  parseThToolsCategoryPage,
  thToolsCategoryName,
  thToolsCategoryPageUrl,
  thToolsCategoryPath,
} from './th-tools-category.crawler';

const PAGE_URL = 'https://th-tool.by/category/aksessuary/avtolampy/narva/';

// Trimmed to the link shapes the crawler actually reasons about: the main menu,
// the subcategory list, the product grid, the pager and a static page.
const CATEGORY_HTML = `
<html><body>
  <h1 class="category-name">Narva</h1>
  <a class="c-menu__item-link" href="/category/elektroinstrument/">Электроинструмент</a>
  <a class="h-menu__img-link-1" href="/category/aksessuary/avtolampy/philips/">Philips</a>
  <a href="/avtolampa-h1-55-p14-5s-12v/">Автолампа H1</a>
  <a href="/avtolampa-h7-55-px26d-12v/?utm_source=x#gallery">Автолампа H7</a>
  <a href="https://th-tool.by/avtolampa-h3-55-pk22s-12v/">Автолампа H3</a>
  <a href="/dostavka-i-oplata/">Доставка и оплата</a>
  <a href="https://vk.com/th-tool">ВКонтакте</a>
  <a href="#top">Наверх</a>
  <a href="/category/aksessuary/avtolampy/narva/?page=2">2</a>
  <a href="/category/aksessuary/avtolampy/narva/?page=3">3</a>
</body></html>`;

describe('parseThToolsCategoryPage', () => {
  const parsed = parseThToolsCategoryPage(CATEGORY_HTML, PAGE_URL);

  it('collects product URLs and drops query strings and fragments', () => {
    expect(parsed.productUrls.sort()).toEqual([
      'https://th-tool.by/avtolampa-h1-55-p14-5s-12v/',
      'https://th-tool.by/avtolampa-h3-55-pk22s-12v/',
      'https://th-tool.by/avtolampa-h7-55-px26d-12v/',
    ]);
  });

  it('does not mistake static pages, categories or offsite links for products', () => {
    const joined = parsed.productUrls.join(' ');
    expect(joined).not.toContain('dostavka-i-oplata');
    expect(joined).not.toContain('/category/');
    expect(joined).not.toContain('vk.com');
  });

  it('collects subcategory URLs', () => {
    expect(parsed.categoryUrls).toContain(
      'https://th-tool.by/category/aksessuary/avtolampy/philips/',
    );
    expect(parsed.categoryUrls).toContain(
      'https://th-tool.by/category/elektroinstrument/',
    );
  });

  it('reads the furthest page the pager links to', () => {
    expect(parsed.maxLinkedPage).toBe(3);
  });

  it('falls back to page 1 when there is no pager', () => {
    const single = parseThToolsCategoryPage(
      '<html><body><a href="/molotok/">Молоток</a></body></html>',
      PAGE_URL,
    );
    expect(single.maxLinkedPage).toBe(1);
  });

  it('reads the category name', () => {
    expect(parsed.name).toBe('Narva');
  });
});

describe('category URL helpers', () => {
  it('recognises category URLs', () => {
    expect(isThToolsCategoryUrl(PAGE_URL)).toBe(true);
    expect(isThToolsCategoryUrl('https://th-tool.by/category/')).toBe(false);
    expect(isThToolsCategoryUrl('https://th-tool.by/molotok/')).toBe(false);
    expect(isThToolsCategoryUrl('not a url')).toBe(false);
  });

  it('derives the slug path and a readable name', () => {
    expect(thToolsCategoryPath(PAGE_URL)).toEqual([
      'aksessuary',
      'avtolampy',
      'narva',
    ]);
    expect(thToolsCategoryName(PAGE_URL)).toBe('narva');
  });

  it('builds page URLs, leaving page 1 untouched', () => {
    expect(thToolsCategoryPageUrl(PAGE_URL, 1)).toBe(PAGE_URL);
    expect(thToolsCategoryPageUrl(PAGE_URL, 4)).toBe(`${PAGE_URL}?page=4`);
  });
});
