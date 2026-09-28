"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserJobService = void 0;
const common_1 = require("@nestjs/common");
const source_websites_service_1 = require("../source-websites/source-websites.service");
const products_service_1 = require("../products/products.service");
const categories_service_1 = require("../categories/categories.service");
const parser_service_1 = require("./parser.service");
const playwright_service_1 = require("./playwright.service");
const sitemap_service_1 = require("./sitemap.service");
let ParserJobService = class ParserJobService {
    parserService;
    playwrightService;
    sitemapService;
    sourceWebsitesService;
    productsService;
    categoriesService;
    constructor(parserService, playwrightService, sitemapService, sourceWebsitesService, productsService, categoriesService) {
        this.parserService = parserService;
        this.playwrightService = playwrightService;
        this.sitemapService = sitemapService;
        this.sourceWebsitesService = sourceWebsitesService;
        this.productsService = productsService;
        this.categoriesService = categoriesService;
    }
    async parseUrl(url, sourceWebsiteId) {
        try {
            let config;
            let websiteName = 'default';
            if (sourceWebsiteId) {
                const website = await this.sourceWebsitesService.findOne(sourceWebsiteId);
                config = website.parserConfig || {};
                websiteName = website.name;
            }
            else {
                const hostname = new URL(url).hostname;
                websiteName = hostname.replace('www.', '');
                config = this.parserService.getDefaultConfigForSite(websiteName);
            }
            let parsedProduct;
            if (config.usePlaywright) {
                console.log(`Using Playwright to parse: ${url}`);
                parsedProduct = await this.parserService.parseWithPlaywright(url, config);
            }
            else {
                console.log(`Using Cheerio to parse: ${url}`);
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    },
                });
                if (!response.ok) {
                    throw new Error(`Failed to fetch URL: ${response.status}`);
                }
                const html = await response.text();
                parsedProduct = await this.parserService.parseHtml(html, config, url);
            }
            const productDto = {
                name: parsedProduct.name,
                price: parsedProduct.price,
                oldPrice: parsedProduct.oldPrice,
                currency: parsedProduct.currency,
                brand: parsedProduct.brand,
                model: parsedProduct.model,
                article: parsedProduct.article,
                barcode: parsedProduct.barcode,
                description: parsedProduct.description,
                inStock: parsedProduct.inStock,
                stockQuantity: parsedProduct.stockQuantity,
                availabilityText: parsedProduct.availabilityText,
                weight: parsedProduct.weight,
                dimensions: parsedProduct.dimensions,
                images: parsedProduct.images,
                mainImage: parsedProduct.mainImage,
                specifications: parsedProduct.specifications,
                features: parsedProduct.features,
                countryOfOrigin: parsedProduct.countryOfOrigin,
                warranty: parsedProduct.warranty,
                manufacturer: parsedProduct.manufacturer,
                sourceWebsiteId,
            };
            const savedProduct = await this.productsService.upsertBySourceUrl(url, productDto);
            console.log(`Successfully parsed and saved product: ${savedProduct.id}`);
            return {
                success: true,
                product: parsedProduct,
            };
        }
        catch (error) {
            console.error('Parse error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async parseSitemap(sitemapUrl, options) {
        try {
            console.log(`Parsing sitemap: ${sitemapUrl}`);
            const allUrls = await this.sitemapService.parseSitemapRecursive(sitemapUrl, options?.maxDepth || 3);
            let filteredUrls = allUrls;
            if (options?.productPattern) {
                filteredUrls = this.sitemapService.filterUrlsByPattern(allUrls, options.productPattern);
                console.log(`Filtered to ${filteredUrls.length} product URLs`);
            }
            const productUrls = filteredUrls.map((u) => u.loc);
            const sitemaps = new Set();
            return {
                totalUrls: filteredUrls.length,
                productUrls,
                sitemaps: Array.from(sitemaps),
            };
        }
        catch (error) {
            console.error('Sitemap parse error:', error);
            throw error;
        }
    }
    async parseProductsFromSitemap(sitemapUrl, sourceWebsiteId, options) {
        const sitemapResult = await this.parseSitemap(sitemapUrl, {
            productPattern: options?.productPattern,
            maxDepth: options?.maxDepth,
        });
        const urls = sitemapResult.productUrls;
        const concurrency = options?.concurrency || 5;
        const delayMs = options?.delayMs || 100;
        console.log(`Parsing ${urls.length} products with concurrency ${concurrency}`);
        const results = [];
        const batches = this.chunkArray(urls, concurrency);
        for (const batch of batches) {
            const batchResults = await Promise.all(batch.map((url) => this.parseUrl(url, sourceWebsiteId)));
            results.push(...batchResults);
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        const success = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        return {
            total: urls.length,
            success,
            failed,
            results,
        };
    }
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
    async parseMultipleUrls(urls, sourceWebsiteId) {
        const results = [];
        for (const url of urls) {
            const result = await this.parseUrl(url, sourceWebsiteId);
            results.push(result);
        }
        return results;
    }
    async parseCategoryPage(url, sourceWebsiteId) {
        try {
            const website = await this.sourceWebsitesService.findOne(sourceWebsiteId);
            const config = website.parserConfig || {};
            const html = await this.playwrightService.fetchPageContent(url, {
                waitForSelector: config.waitForSelector,
                scroll: true,
            });
            const $ = cheerio.load(html);
            const productUrls = [];
            const selectors = [
                '.product-link a',
                '.product-item a',
                '.catalog-product a',
                '[data-test="product-card"] a',
                '.product a.title',
            ];
            for (const selector of selectors) {
                $(selector).each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && href.includes('/product/')) {
                        const fullUrl = this.resolveUrl(href, config.baseUrl || url);
                        if (!productUrls.includes(fullUrl)) {
                            productUrls.push(fullUrl);
                        }
                    }
                });
            }
            return { productUrls };
        }
        catch (error) {
            return {
                productUrls: [],
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    resolveUrl(url, baseUrl) {
        if (url.startsWith('http'))
            return url;
        const base = new URL(baseUrl);
        if (url.startsWith('/')) {
            return `${base.protocol}//${base.host}${url}`;
        }
        return `${base.protocol}//${base.host}${base.pathname}${url}`;
    }
    async parseCategoriesFromSitemap(sitemapUrl, sourceWebsiteId) {
        console.log(`Parsing categories from sitemap: ${sitemapUrl}`);
        const allUrls = await this.sitemapService.parseSitemapRecursive(sitemapUrl, 3);
        const categoryUrls = allUrls.filter((u) => u.loc.includes('/category/'));
        console.log(`Found ${categoryUrls.length} category URLs`);
        const categories = [];
        const categoryMap = new Map();
        for (const catUrl of categoryUrls) {
            try {
                const url = new URL(catUrl.loc);
                const pathParts = url.pathname.replace('/category/', '').split('/').filter(Boolean);
                let parentId = undefined;
                let categoryId = undefined;
                for (let i = 0; i < pathParts.length; i++) {
                    const slug = pathParts[i];
                    const fullPath = pathParts.slice(0, i + 1).join('/');
                    const mapKey = `cat_${fullPath}`;
                    if (categoryMap.has(mapKey)) {
                        const existing = categoryMap.get(mapKey);
                        parentId = existing.id;
                        categoryId = parentId;
                        continue;
                    }
                    const categoryData = {
                        name: this.slugToName(slug),
                        slug: slug,
                        parentId: parentId,
                        sourceWebsiteId: sourceWebsiteId || undefined,
                        depth: i,
                    };
                    const category = await this.categoriesService.create(categoryData);
                    categoryMap.set(mapKey, category);
                    parentId = category.id;
                    categoryId = parentId;
                    categories.push(category);
                    console.log(`Created category: ${category.name} (depth: ${i})`);
                }
            }
            catch (error) {
                console.error(`Failed to create category from ${catUrl.loc}:`, error);
            }
        }
        return {
            totalCategories: categories.length,
            categories,
        };
    }
    async parseProductsWithCategories(sitemapUrl, sourceWebsiteId, options) {
        if (options?.parseCategoriesFirst) {
            await this.parseCategoriesFromSitemap(sitemapUrl, sourceWebsiteId);
        }
        const allUrls = await this.sitemapService.parseSitemapRecursive(sitemapUrl, options?.maxDepth || 3);
        let productUrls = allUrls.filter((u) => !u.loc.includes('/category/') &&
            !u.loc.includes('/hub/') &&
            !u.loc.includes('/photos/') &&
            !u.loc.includes('/o-nas/') &&
            !u.loc.includes('/dealers/') &&
            !u.loc.includes('/garantii/') &&
            !u.loc.includes('/dostavka/') &&
            !u.loc.includes('/kontakty/') &&
            !u.loc.includes('/service-center/') &&
            !u.loc.includes('/obligatsii/') &&
            !u.loc.includes('/politika/') &&
            u.loc !== 'https://th-tool.by/');
        if (options?.productPattern) {
            const regex = new RegExp(options.productPattern);
            productUrls = productUrls.filter((u) => regex.test(u.loc));
        }
        console.log(`Parsing ${productUrls.length} products`);
        const urls = productUrls.map((u) => u.loc);
        const concurrency = options?.concurrency || 5;
        const delayMs = options?.delayMs || 100;
        const results = [];
        const batches = this.chunkArray(urls, concurrency);
        for (const batch of batches) {
            const batchResults = await Promise.all(batch.map((url) => this.parseUrlWithCategory(url, sourceWebsiteId)));
            results.push(...batchResults);
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        const success = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        return {
            total: urls.length,
            success,
            failed,
            results,
        };
    }
    async parseUrlWithCategory(url, sourceWebsiteId) {
        const result = await this.parseUrl(url, sourceWebsiteId);
        if (result.success && sourceWebsiteId) {
            try {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                if (pathParts.length > 0) {
                    const lastSlug = pathParts[pathParts.length - 1];
                    const categories = await this.categoriesService.findAll(sourceWebsiteId);
                    const matchingCategory = categories.find((c) => c.slug === lastSlug || pathParts.includes(c.slug));
                    if (matchingCategory) {
                        const product = await this.productsService.findOne(result.product.sourceId || url);
                        if (product && product.id) {
                            await this.productsService.update(product.id, {
                                categoryId: matchingCategory.id,
                            });
                        }
                    }
                }
            }
            catch (error) {
                console.warn(`Failed to assign category for ${url}:`, error);
            }
        }
        return result;
    }
    slugToName(slug) {
        return slug
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
};
exports.ParserJobService = ParserJobService;
exports.ParserJobService = ParserJobService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [parser_service_1.ParserService,
        playwright_service_1.PlaywrightService,
        sitemap_service_1.SitemapService,
        source_websites_service_1.SourceWebsitesService,
        products_service_1.ProductsService,
        categories_service_1.CategoriesService])
], ParserJobService);
const cheerio = __importStar(require("cheerio"));
//# sourceMappingURL=parser-job.service.js.map