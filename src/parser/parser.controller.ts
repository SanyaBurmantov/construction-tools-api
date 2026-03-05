import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { ParserJobService } from './parser-job.service';
import { ParserService } from './parser.service';
import { ParserJobQueueService } from './parser-job-queue.service';

@ApiTags('parser')
@Controller('parser')
export class ParserController {
  constructor(
    private readonly parserJobService: ParserJobService,
    private readonly parserService: ParserService,
    private readonly parserJobQueue: ParserJobQueueService,
  ) {}

  @Post('parse-url')
  @ApiOperation({ summary: 'Спарсить URL и сохранить товар' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', example: 'https://tools.by/product/1605300' },
        sourceWebsiteId: { type: 'string', description: 'e5bd13ac-3f1a-486a-8fef-c9cc039cce04' },
      },
      required: ['url'],
    },
  })
  @ApiResponse({ status: 200, description: 'Товар успешно спаршен' })
  async parseUrl(
    @Body('url') url: string,
    @Body('sourceWebsiteId') sourceWebsiteId?: string,
  ) {
    console.log('1111111111111111111111111111');
    return this.parserJobService.parseUrl(url, sourceWebsiteId);
  }

  @Post('parse-batch')
  @ApiOperation({ summary: 'Спарсить несколько URL' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, example: ['https://tools.by/product/1605300'] },
        sourceWebsiteId: { type: 'string', description: 'ID источника' },
      },
      required: ['urls'],
    },
  })
  async parseBatch(
    @Body('urls') urls: string[],
    @Body('sourceWebsiteId') sourceWebsiteId?: string,
  ) {
    return this.parserJobService.parseMultipleUrls(urls, sourceWebsiteId);
  }

  @Get('preview')
  @ApiOperation({ summary: 'Предпросмотр парсинга' })
  @ApiQuery({ name: 'url', required: true, description: 'URL для парсинга' })
  @ApiQuery({ name: 'sourceWebsiteId', required: false, description: 'ID источника' })
  async previewParse(
    @Query('url') url: string,
    @Query('sourceWebsiteId') sourceWebsiteId?: string,
  ) {
    return this.parserJobService.parseUrl(url, sourceWebsiteId);
  }

  @Post('parse-category')
  @ApiOperation({ summary: 'Спарсить страницу категории (извлечь ссылки на товары)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL страницы категории' },
        sourceWebsiteId: { type: 'string', description: 'ID источника' },
      },
      required: ['url', 'sourceWebsiteId'],
    },
  })
  async parseCategory(
    @Body('url') url: string,
    @Body('sourceWebsiteId') sourceWebsiteId: string,
  ) {
    return this.parserJobService.parseCategoryPage(url, sourceWebsiteId);
  }

  @Post('sitemap/parse')
  @ApiOperation({ summary: 'Распарсить sitemap.xml и получить URL' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sitemapUrl: {
          type: 'string',
          example: 'https://th-tool.by/sitemap.xml',
          description: 'URL sitemap.xml файла',
        },
        productPattern: {
          type: 'string',
          example: '/press-',
          description: 'Regex паттерн для фильтрации URL (например, только товары)',
        },
        maxDepth: {
          type: 'number',
          example: 3,
          description: 'Максимальная глубина рекурсии для вложенных sitemap',
        },
      },
      required: ['sitemapUrl'],
    },
  })
  @ApiResponse({ status: 200, description: 'Sitemap успешно распарсен' })
  async parseSitemap(
    @Body('sitemapUrl') sitemapUrl: string,
    @Body('productPattern') productPattern?: string,
    @Body('maxDepth') maxDepth?: number,
  ) {
    return this.parserJobService.parseSitemap(sitemapUrl, {
      productPattern,
      maxDepth,
    });
  }

  @Post('sitemap/parse-products')
  @ApiOperation({ summary: 'Распарсить sitemap и сохранить все товары в БД' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sitemapUrl: {
          type: 'string',
          example: 'https://th-tool.by/sitemap.xml',
          description: 'URL sitemap.xml файла',
        },
        sourceWebsiteId: {
          type: 'string',
          description: 'ID источника для сохранения товаров',
        },
        productPattern: {
          type: 'string',
          example: '/press-',
          description: 'Regex паттерн для фильтрации URL',
        },
        maxDepth: {
          type: 'number',
          example: 3,
          description: 'Максимальная глубина рекурсии',
        },
        concurrency: {
          type: 'number',
          example: 5,
          description: 'Количество одновременных запросов',
        },
        delayMs: {
          type: 'number',
          example: 200,
          description: 'Задержка между батчами (мс)',
        },
      },
      required: ['sitemapUrl'],
    },
  })
  @ApiResponse({ status: 200, description: 'Товары успешно спаршены' })
  async parseProductsFromSitemap(
    @Body('sitemapUrl') sitemapUrl: string,
    @Body('sourceWebsiteId') sourceWebsiteId?: string,
    @Body('productPattern') productPattern?: string,
    @Body('maxDepth') maxDepth?: number,
    @Body('concurrency') concurrency?: number,
    @Body('delayMs') delayMs?: number,
  ) {
    return this.parserJobService.parseProductsFromSitemap(sitemapUrl, sourceWebsiteId, {
      productPattern,
      maxDepth,
      concurrency,
      delayMs,
    });
  }

  @Get('sitemap/preview')
  @ApiOperation({ summary: 'Предпросмотр sitemap (быстрый)' })
  @ApiQuery({ name: 'sitemapUrl', required: true, description: 'URL sitemap.xml' })
  @ApiQuery({ name: 'limit', required: false, description: 'Лимит URL для предпросмотра' })
  async previewSitemap(
    @Query('sitemapUrl') sitemapUrl: string,
    @Query('limit') limit: number = 10,
  ) {
    const result = await this.parserJobService.parseSitemap(sitemapUrl, {
      maxDepth: 1,
    });
    return {
      totalUrls: result.totalUrls,
      previewUrls: result.productUrls.slice(0, limit),
      sitemaps: result.sitemaps,
    };
  }

  @Post('jobs/start')
  @ApiOperation({ summary: 'Запустить массовый парсинг из sitemap' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'Parse all products from TH-Tool',
          description: 'Название задачи',
        },
        sitemapUrl: {
          type: 'string',
          example: 'https://th-tool.by/sitemap.xml',
          description: 'URL sitemap.xml',
        },
        sourceWebsiteId: {
          type: 'string',
          description: 'ID источника для сохранения товаров',
        },
        productPattern: {
          type: 'string',
          example: '/press-',
          description: 'Regex паттерн для фильтрации URL (опционально)',
        },
        concurrency: {
          type: 'number',
          example: 5,
          description: 'Количество одновременных запросов',
        },
        delayMs: {
          type: 'number',
          example: 200,
          description: 'Задержка между батчами (мс)',
        },
      },
      required: ['name', 'sitemapUrl'],
    },
  })
  @ApiResponse({ status: 200, description: 'Задача создана и запущена' })
  async startJob(
    @Body('name') name: string,
    @Body('sitemapUrl') sitemapUrl: string,
    @Body('sourceWebsiteId') sourceWebsiteId?: string,
    @Body('productPattern') productPattern?: string,
    @Body('concurrency') concurrency?: number,
    @Body('delayMs') delayMs?: number,
  ) {
    return this.parserJobQueue.createJob({
      name,
      sitemapUrl,
      sourceWebsiteId,
      productPattern,
      concurrency,
      delayMs,
    });
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Получить все задачи парсинга' })
  async getAllJobs() {
    return this.parserJobQueue.getAllJobs();
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Получить статус задачи' })
  @ApiParam({ name: 'jobId', description: 'ID задачи' })
  async getJobStatus(@Param('jobId') jobId: string) {
    const job = this.parserJobQueue.getJobStatus(jobId);
    if (!job) {
      return { message: 'Job not found' };
    }
    return job;
  }

  @Delete('jobs/:jobId')
  @ApiOperation({ summary: 'Удалить завершенную задачу' })
  @ApiParam({ name: 'jobId', description: 'ID задачи' })
  async deleteJob(@Param('jobId') jobId: string) {
    const deleted = this.parserJobQueue.deleteJob(jobId);
    return { success: deleted };
  }

  @Post('sitemap/parse-with-categories')
  @ApiOperation({ summary: 'Распарсить sitemap: сначала категории, потом товары с привязкой' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sitemapUrl: {
          type: 'string',
          example: 'https://th-tool.by/sitemap.xml',
          description: 'URL sitemap.xml',
        },
        sourceWebsiteId: {
          type: 'string',
          description: 'ID источника',
        },
        concurrency: {
          type: 'number',
          example: 10,
          description: 'Количество одновременных запросов',
        },
        delayMs: {
          type: 'number',
          example: 100,
          description: 'Задержка между батчами (мс)',
        },
      },
      required: ['sitemapUrl', 'sourceWebsiteId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Парсинг запущен' })
  async parseProductsWithCategories(
    @Body('sitemapUrl') sitemapUrl: string,
    @Body('sourceWebsiteId') sourceWebsiteId?: string,
    @Body('concurrency') concurrency?: number,
    @Body('delayMs') delayMs?: number,
  ) {
    return this.parserJobService.parseProductsWithCategories(sitemapUrl, sourceWebsiteId, {
      concurrency,
      delayMs,
      parseCategoriesFirst: true,
    });
  }
}
