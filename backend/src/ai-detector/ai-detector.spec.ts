import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageText } from './page-text';
import { assertPublicUrl, isPublicAddress, UnsafeUrlError } from './safe-url';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.18.0.5', // a docker compose network
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('refuses %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['87.232.67.114', '8.8.8.8', '172.32.0.1', '2a0a:7d80:3:2::2a5'])(
    'allows %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );
});

describe('assertPublicUrl', () => {
  const resolveTo =
    (...ips: string[]) =>
    () =>
      Promise.resolve(ips);

  it('accepts a public page', async () => {
    const url = await assertPublicUrl(
      'https://gost.by/catalog',
      resolveTo('87.232.67.114'),
    );
    expect(url.hostname).toBe('gost.by');
  });

  it.each([
    ['ftp://gost.by/x', 'http'],
    ['http://user:pw@gost.by/', 'логином'],
    ['http://gost.by:5432/', 'порты'],
    ['не адрес', 'не адрес'],
  ])('refuses %s', async (raw, reason) => {
    await expect(
      assertPublicUrl(raw, resolveTo('87.232.67.114')),
    ).rejects.toThrow(reason);
  });

  it('refuses a name that resolves inside the compose network', async () => {
    await expect(
      assertPublicUrl(
        'http://backend:8000/admin/stats',
        resolveTo('172.18.0.4'),
      ),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses when any of the addresses is private', async () => {
    await expect(
      assertPublicUrl(
        'http://mixed.example/',
        resolveTo('8.8.8.8', '127.0.0.1'),
      ),
    ).rejects.toThrow('Внутренние');
  });

  it('refuses a literal private IP without resolving', async () => {
    const resolve = jest.fn();
    await expect(assertPublicUrl('http://[::1]/', resolve)).rejects.toThrow(
      'Внутренние',
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reports a host that does not exist', async () => {
    await expect(
      assertPublicUrl('https://nope.invalid/', () =>
        Promise.reject(new Error('ENOTFOUND')),
      ),
    ).rejects.toThrow('не найден');
  });
});

describe('extractPageText', () => {
  const lorem =
    'Перфоратор предназначен для сверления бетона и кирпича. ' +
    'Патрон SDS-plus, энергия удара 2,7 Дж, мощность 800 Вт. ';

  it('prefers the product description over menus and footers', () => {
    const html = `<html><head><title>Перфоратор — gost.by</title></head><body>
      <header><nav><a>Каталог</a><a>Доставка</a></nav></header>
      <div itemprop="description"><p>${lorem.repeat(3)}</p><p>Второй абзац описания.</p></div>
      <footer><p>${'Подвал сайта, телефоны и адреса. '.repeat(20)}</p></footer>
      <script>var x = "не текст";</script></body></html>`;
    const page = extractPageText(html);
    expect(page.title).toBe('Перфоратор — gost.by');
    expect(page.picked).toBe('описание товара');
    expect(page.text).toContain('Второй абзац описания.');
    expect(page.text).not.toMatch(/Подвал|Каталог|не текст/);
    expect(page.text.split('\n\n')).toHaveLength(2);
  });

  it('falls back to the block with the most paragraph text', () => {
    const html = `<body><div class="side"><p>Коротко.</p></div>
      <div class="content"><p>${lorem.repeat(2)}</p><p>${lorem}</p></div></body>`;
    const page = extractPageText(html);
    expect(page.picked).toBe('самый большой блок текста');
    expect(page.text).not.toContain('Коротко.');
  });

  it('reads a real supplier page', () => {
    const html = readFileSync(
      join(__dirname, '../parser/sites/fixtures/th-tools-product.html'),
      'utf8',
    );
    const page = extractPageText(html);
    expect(page.text).toContain('Твердосплавная борфреза');
    expect(page.text.length).toBeGreaterThan(300);
  });
});
