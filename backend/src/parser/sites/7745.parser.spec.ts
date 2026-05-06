import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse7745 } from './7745.parser';

describe('parse7745', () => {
  it('parses product data from 7745 fixture', () => {
    const html = readFileSync(
      join(__dirname, 'fixtures', '7745-product.html'),
      'utf8',
    );

    expect(parse7745(html)).toEqual({
      name: 'Перфоратор тестовый 7745 P-123',
      price: 199.9,
      images: [
        'https://7745.by/upload/products/main.webp',
        'https://7745.by/upload/products/extra.jpg',
        'https://7745.by/upload/products/gallery-thumb.jpg',
      ],
      description: 'Полное описание товара 7745.',
      specifications: [
        { name: 'Артикул', value: 'P-123' },
        { name: 'Мощность', value: '800 Вт' },
        { name: 'Вес', value: '2.5 кг' },
      ],
    });
  });
});
