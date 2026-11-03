import {
  mailItems,
  mailLayout,
  mailRows,
  mailTotals,
  money,
} from './mail-layout';

const STORED =
  'https://storage-1339.s3hoster.by/gost-by-media/v/ab/abababababababababababababababababababab/1200.webp';

describe('money', () => {
  it('prints prices the way the storefront does', () => {
    expect(money(1234.5, 'BYN')).toBe('1 234,50 Br');
    expect(money(0.9, 'BYN')).toBe('0,90 Br');
  });
});

describe('mailLayout', () => {
  const html = mailLayout({
    brand: {
      siteUrl: 'https://gost.by/',
      seller: { phone: '+375 (29) 000-00-00', email: '' },
    },
    preheader: 'Строка <превью>',
    title: 'Заказ <№1>',
    body: '<p>тело</p>',
  });

  it('is a whole document with the logo, the site link and the title escaped', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('https://gost.by/apple-touch-icon.png');
    expect(html).toContain('Заказ &lt;№1&gt;');
    expect(html).toContain('Строка &lt;превью&gt;');
    expect(html).toContain('<p>тело</p>');
  });

  it('puts the seller in the footer, a blank field keeping the default', () => {
    expect(html).toContain('ООО «Мультитул»');
    expect(html).toContain('УНП 391807521');
    expect(html).toContain('href="tel:+375290000000"');
    expect(html).toContain('mailto:support@gost.by');
  });
});

describe('mailRows', () => {
  it('escapes values and links the ones with an href', () => {
    const html = mailRows([
      ['Имя', '<script>alert(1)</script>'],
      ['Телефон', '+375 29 1', 'tel:+375291'],
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="tel:+375291"');
  });
});

describe('mailItems', () => {
  it('links names, takes the thumbnail size of our photos and keeps others as they are', () => {
    const html = mailItems(
      [
        {
          name: 'Дрель <X>',
          quantity: 2,
          unitPrice: 50,
          lineTotal: 100,
          href: 'https://gost.by/product/drel',
          image: STORED,
        },
        {
          name: 'Бур',
          quantity: 1,
          unitPrice: 5,
          lineTotal: 5,
          image: 'https://dukon.by/upload/1.jpg',
        },
        { name: 'Без фото', quantity: 1, unitPrice: 1, lineTotal: 1 },
      ],
      'BYN',
    );
    expect(html).toContain('Дрель &lt;X&gt;');
    expect(html).toContain('href="https://gost.by/product/drel"');
    expect(html).toContain(STORED.replace('1200.webp', '160.webp'));
    expect(html).not.toContain('1200.webp');
    expect(html).toContain('https://dukon.by/upload/1.jpg');
    expect(html).toContain('100,00&nbsp;Br');
  });
});

describe('mailTotals', () => {
  it('sets the last row as the grand total', () => {
    const html = mailTotals([
      ['Товары', '100,00 Br'],
      ['Итого', '115,00 Br'],
    ]);
    expect(html.lastIndexOf('font-weight:800')).toBeGreaterThan(
      html.indexOf('Товары'),
    );
    expect(html).toContain('115,00&nbsp;Br');
  });
});
