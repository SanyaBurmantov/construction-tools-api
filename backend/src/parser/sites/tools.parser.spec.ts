import { parseTools } from './tools.parser';

describe('parseTools', () => {
  it('parses product data from common Tools.by markup variants', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="SEO Tools товар" />
          <meta property="og:image" content="/upload/products/main.webp" />
          <meta name="description" content="SEO описание Tools.by" />
          <meta property="product:price:amount" content="123,45" />
        </head>
        <body>
          <h1>Дрель тестовая Tools T-123</h1>
          <span id="product_artikul">T-123</span>
          <div class="product__description">
            <p>Полное описание Tools.by</p>
            <table>
              <tr><td>Мощность:</td><td>800 Вт</td></tr>
            </table>
          </div>
          <dl>
            <dt>Вес</dt><dd>2 кг</dd>
          </dl>
          <div class="product__carousel">
            <img data-src="/upload/products/gallery.jpg" />
            <a href="https://tools.by/upload/products/extra.png">Фото</a>
            <img src="/local/templates/logos/logo.svg" />
          </div>
        </body>
      </html>
    `;

    expect(parseTools(html)).toEqual({
      name: 'Дрель тестовая Tools T-123',
      price: 123.45,
      images: [
        'https://tools.by/upload/products/main.webp',
        'https://tools.by/upload/products/gallery.jpg',
        'https://tools.by/upload/products/extra.png',
      ],
      description: 'Полное описание Tools.by Мощность:800 Вт',
      specifications: [
        { name: 'Артикул', value: 'T-123' },
        { name: 'Мощность', value: '800 Вт' },
        { name: 'Вес', value: '2 кг' },
      ],
    });
  });
});
