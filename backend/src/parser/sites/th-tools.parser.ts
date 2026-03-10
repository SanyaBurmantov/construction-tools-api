import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { ProductImage, TProduct } from '../../products/types/product.type';
import { generateSlug } from '../../common/utils/generate-slug';

@Injectable()
export class ThToolsParserService {
  constructor(private prisma: PrismaService) {}

  async getUnvisitedSitemaps(limit = 10) {
    return this.prisma.sitemapsThTools.findMany({
      where: { isVisited: false },
      take: limit,
    });
  }

  async processSitemapsBatch(limit = 100, concurrency = 5) {
    const urls = await this.getUnvisitedSitemaps(limit);
    if (!urls.length) return;

    const limitConcurrency = pLimit(concurrency);

    await Promise.all(
      urls.map((sitemap) =>
        limitConcurrency(() => this.processSitemapUrl(sitemap.url)),
      ),
    );
  }

  async processSitemapUrl(url: string) {
    console.log(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}`);

      const html = await res.text();
      const $ = cheerio.load(html);

      const specs: TProduct['specs'] = [{name: '', value: ''}];
      $('.features-two-val__block').each((i, block) => {
        const name = $(block).find('.features-two-val__name span').text().trim();
        const value = $(block).find('.features-two-val__value').text().trim();
        specs.push({ name, value });
      });

      const images: ProductImage[] = [];

      $('.p-images__wrap img').each((i, el) => {
        const alt = $(el).attr('alt');
        const src = $(el).attr('src');
        if (src) {
          const image: ProductImage = {
            alt: alt,
            order: 0,
            url: src

          }
          images.push(image)
        };
      });

      const product: TProduct = {
        id: '',
        slug: generateSlug($('h1').text()?.trim()),
        name: $('h1').text()?.trim(),
        categoryId: '',
        images: images,
        price: {
          value: Number($('.price.product__price').first().text().split(' ')[0]?.trim()),
          currency: String($('.price.product__price').first().text().split(' ')[1]?.trim()),
          oldValue: undefined,
        },
        stock: {
          status: 'in_stock',
          quantity: undefined,
        },
        specs: specs as TProduct['specs'],
        description: {
          short: undefined,
          full: $('.desc.desc_max').text()?.trim(),
          features: undefined,
        },
        specifications: [],
        seo: {
          title: $('h1').text().trim(),
          description: $('.desc.desc_max').text()?.trim(),
          keywords: undefined,
        },
      };


      console.log(product);
      // Сохраняем товар (можно отдельную таблицу)
      // await this.prisma.product.create({
      //   data: {
      //     url,
      //     title,
      //     price,
      //   },
      // });

      // await this.prisma.sitemapsThTools.update({
      //   where: { url },
      //   data: { isVisited: true },
      // });
    } catch (e) {
      console.error(`Error processing ${url}`, e);
    }
  }

}