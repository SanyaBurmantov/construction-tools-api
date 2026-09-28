import * as cheerio from 'cheerio';
import { TParsedProduct } from '../types/parsed-product.type';

export function parseTM(html: string): TParsedProduct {
  const $ = cheerio.load(html);

  const name = $('h1').text().trim();

  const priceText = $('.price').first().text();

  const price = Number(priceText.replace(/[^\d]/g, ''));

  const images: string[] = [];

  $('.product-image img').each((_, el) => {
    images.push($(el).attr('src') || '');
  });

  const specs: { name: string; value: string }[] = [];

  $('.specifications tr').each((_, el) => {
    const name = $(el).find('td').eq(0).text().trim();

    const value = $(el).find('td').eq(1).text().trim();

    if (name && value) {
      specs.push({
        name,
        value,
      });
    }
  });

  return {
    name,
    price,
    images,
    specifications: specs,
  };
}
