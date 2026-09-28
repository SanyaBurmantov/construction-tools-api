"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const parser_job_service_1 = require("./parser-job.service");
const parser_service_1 = require("./parser.service");
const parser_job_queue_service_1 = require("./parser-job-queue.service");
let ParserController = class ParserController {
    parserJobService;
    parserService;
    parserJobQueue;
    constructor(parserJobService, parserService, parserJobQueue) {
        this.parserJobService = parserJobService;
        this.parserService = parserService;
        this.parserJobQueue = parserJobQueue;
    }
    async parseUrl(url, sourceWebsiteId) {
        return this.parserJobService.parseUrl(url, sourceWebsiteId);
    }
    async parseBatch(urls, sourceWebsiteId) {
        return this.parserJobService.parseMultipleUrls(urls, sourceWebsiteId);
    }
    async previewParse(url, sourceWebsiteId) {
        return this.parserJobService.parseUrl(url, sourceWebsiteId);
    }
    async parseCategory(url, sourceWebsiteId) {
        return this.parserJobService.parseCategoryPage(url, sourceWebsiteId);
    }
    async parseSitemap(sitemapUrl, productPattern, maxDepth) {
        return this.parserJobService.parseSitemap(sitemapUrl, {
            productPattern,
            maxDepth,
        });
    }
    async parseProductsFromSitemap(sitemapUrl, sourceWebsiteId, productPattern, maxDepth, concurrency, delayMs) {
        return this.parserJobService.parseProductsFromSitemap(sitemapUrl, sourceWebsiteId, {
            productPattern,
            maxDepth,
            concurrency,
            delayMs,
        });
    }
    async previewSitemap(sitemapUrl, limit = 10) {
        const result = await this.parserJobService.parseSitemap(sitemapUrl, {
            maxDepth: 1,
        });
        return {
            totalUrls: result.totalUrls,
            previewUrls: result.productUrls.slice(0, limit),
            sitemaps: result.sitemaps,
        };
    }
    async startJob(name, sitemapUrl, sourceWebsiteId, productPattern, concurrency, delayMs) {
        return this.parserJobQueue.createJob({
            name,
            sitemapUrl,
            sourceWebsiteId,
            productPattern,
            concurrency,
            delayMs,
        });
    }
    async getAllJobs() {
        return this.parserJobQueue.getAllJobs();
    }
    async getJobStatus(jobId) {
        const job = this.parserJobQueue.getJobStatus(jobId);
        if (!job) {
            return { message: 'Job not found' };
        }
        return job;
    }
    async deleteJob(jobId) {
        const deleted = this.parserJobQueue.deleteJob(jobId);
        return { success: deleted };
    }
    async parseProductsWithCategories(sitemapUrl, sourceWebsiteId, concurrency, delayMs) {
        return this.parserJobService.parseProductsWithCategories(sitemapUrl, sourceWebsiteId, {
            concurrency,
            delayMs,
            parseCategoriesFirst: true,
        });
    }
};
exports.ParserController = ParserController;
__decorate([
    (0, common_1.Post)('parse-url'),
    (0, swagger_1.ApiOperation)({ summary: 'Спарсить URL и сохранить товар' }),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                url: { type: 'string', example: 'https://tools.by/product/1605300' },
                sourceWebsiteId: { type: 'string', description: 'ID источника (необязательно)' },
            },
            required: ['url'],
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Товар успешно спаршен' }),
    __param(0, (0, common_1.Body)('url')),
    __param(1, (0, common_1.Body)('sourceWebsiteId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "parseUrl", null);
__decorate([
    (0, common_1.Post)('parse-batch'),
    (0, swagger_1.ApiOperation)({ summary: 'Спарсить несколько URL' }),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                urls: { type: 'array', items: { type: 'string' }, example: ['https://tools.by/product/1605300'] },
                sourceWebsiteId: { type: 'string', description: 'ID источника' },
            },
            required: ['urls'],
        },
    }),
    __param(0, (0, common_1.Body)('urls')),
    __param(1, (0, common_1.Body)('sourceWebsiteId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array, String]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "parseBatch", null);
__decorate([
    (0, common_1.Get)('preview'),
    (0, swagger_1.ApiOperation)({ summary: 'Предпросмотр парсинга' }),
    (0, swagger_1.ApiQuery)({ name: 'url', required: true, description: 'URL для парсинга' }),
    (0, swagger_1.ApiQuery)({ name: 'sourceWebsiteId', required: false, description: 'ID источника' }),
    __param(0, (0, common_1.Query)('url')),
    __param(1, (0, common_1.Query)('sourceWebsiteId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "previewParse", null);
__decorate([
    (0, common_1.Post)('parse-category'),
    (0, swagger_1.ApiOperation)({ summary: 'Спарсить страницу категории (извлечь ссылки на товары)' }),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL страницы категории' },
                sourceWebsiteId: { type: 'string', description: 'ID источника' },
            },
            required: ['url', 'sourceWebsiteId'],
        },
    }),
    __param(0, (0, common_1.Body)('url')),
    __param(1, (0, common_1.Body)('sourceWebsiteId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "parseCategory", null);
__decorate([
    (0, common_1.Post)('sitemap/parse'),
    (0, swagger_1.ApiOperation)({ summary: 'Распарсить sitemap.xml и получить URL' }),
    (0, swagger_1.ApiBody)({
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
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Sitemap успешно распарсен' }),
    __param(0, (0, common_1.Body)('sitemapUrl')),
    __param(1, (0, common_1.Body)('productPattern')),
    __param(2, (0, common_1.Body)('maxDepth')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Number]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "parseSitemap", null);
__decorate([
    (0, common_1.Post)('sitemap/parse-products'),
    (0, swagger_1.ApiOperation)({ summary: 'Распарсить sitemap и сохранить все товары в БД' }),
    (0, swagger_1.ApiBody)({
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
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Товары успешно спаршены' }),
    __param(0, (0, common_1.Body)('sitemapUrl')),
    __param(1, (0, common_1.Body)('sourceWebsiteId')),
    __param(2, (0, common_1.Body)('productPattern')),
    __param(3, (0, common_1.Body)('maxDepth')),
    __param(4, (0, common_1.Body)('concurrency')),
    __param(5, (0, common_1.Body)('delayMs')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Number, Number, Number]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "parseProductsFromSitemap", null);
__decorate([
    (0, common_1.Get)('sitemap/preview'),
    (0, swagger_1.ApiOperation)({ summary: 'Предпросмотр sitemap (быстрый)' }),
    (0, swagger_1.ApiQuery)({ name: 'sitemapUrl', required: true, description: 'URL sitemap.xml' }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, description: 'Лимит URL для предпросмотра' }),
    __param(0, (0, common_1.Query)('sitemapUrl')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "previewSitemap", null);
__decorate([
    (0, common_1.Post)('jobs/start'),
    (0, swagger_1.ApiOperation)({ summary: 'Запустить массовый парсинг из sitemap' }),
    (0, swagger_1.ApiBody)({
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
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Задача создана и запущена' }),
    __param(0, (0, common_1.Body)('name')),
    __param(1, (0, common_1.Body)('sitemapUrl')),
    __param(2, (0, common_1.Body)('sourceWebsiteId')),
    __param(3, (0, common_1.Body)('productPattern')),
    __param(4, (0, common_1.Body)('concurrency')),
    __param(5, (0, common_1.Body)('delayMs')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, Number, Number]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "startJob", null);
__decorate([
    (0, common_1.Get)('jobs'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить все задачи парсинга' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "getAllJobs", null);
__decorate([
    (0, common_1.Get)('jobs/:jobId'),
    (0, swagger_1.ApiOperation)({ summary: 'Получить статус задачи' }),
    (0, swagger_1.ApiParam)({ name: 'jobId', description: 'ID задачи' }),
    __param(0, (0, common_1.Param)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "getJobStatus", null);
__decorate([
    (0, common_1.Delete)('jobs/:jobId'),
    (0, swagger_1.ApiOperation)({ summary: 'Удалить завершенную задачу' }),
    (0, swagger_1.ApiParam)({ name: 'jobId', description: 'ID задачи' }),
    __param(0, (0, common_1.Param)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "deleteJob", null);
__decorate([
    (0, common_1.Post)('sitemap/parse-with-categories'),
    (0, swagger_1.ApiOperation)({ summary: 'Распарсить sitemap: сначала категории, потом товары с привязкой' }),
    (0, swagger_1.ApiBody)({
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
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Парсинг запущен' }),
    __param(0, (0, common_1.Body)('sitemapUrl')),
    __param(1, (0, common_1.Body)('sourceWebsiteId')),
    __param(2, (0, common_1.Body)('concurrency')),
    __param(3, (0, common_1.Body)('delayMs')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Number, Number]),
    __metadata("design:returntype", Promise)
], ParserController.prototype, "parseProductsWithCategories", null);
exports.ParserController = ParserController = __decorate([
    (0, swagger_1.ApiTags)('parser'),
    (0, common_1.Controller)('parser'),
    __metadata("design:paramtypes", [parser_job_service_1.ParserJobService,
        parser_service_1.ParserService,
        parser_job_queue_service_1.ParserJobQueueService])
], ParserController);
//# sourceMappingURL=parser.controller.js.map