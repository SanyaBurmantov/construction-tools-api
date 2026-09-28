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
exports.ParserService = void 0;
const common_1 = require("@nestjs/common");
const cheerio = __importStar(require("cheerio"));
const playwright_service_1 = require("./playwright.service");
let ParserService = class ParserService {
    playwrightService;
    constructor(playwrightService) {
        this.playwrightService = playwrightService;
    }
    async parseHtml(html, config, url) {
        const $ = cheerio.load(html);
        return this.extractProductData($, config, url);
    }
    async parseWithPlaywright(url, config) {
        const selectors = {};
        for (const [key, value] of Object.entries(config.selectors)) {
            if (typeof value === 'string') {
                selectors[key] = value;
            }
        }
        const scrapedData = await this.playwrightService.scrapeWithSelectors(url, selectors, {
            waitForSelector: config.waitForSelector,
            waitForTimeout: config.waitForTimeout,
        });
        if (config.clickTabs || config.selectors.tabs) {
            const page = await this.playwrightService.getPage();
            try {
                await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
                await this.clickTabsOnPage(page, config.selectors.tabs);
                await page.waitForTimeout(2000);
                for (const [key, value] of Object.entries(selectors)) {
                    if (!scrapedData[key] || !String(scrapedData[key]).trim()) {
                        try {
                            const element = await page.$(value);
                            if (element) {
                                const text = await element.textContent();
                                if (text && text.trim()) {
                                    scrapedData[key] = text.trim();
                                }
                            }
                        }
                        catch {
                        }
                    }
                }
            }
            finally {
                await page.close();
            }
        }
        let specifications;
        if (config.selectors.specifications?.container) {
            specifications = await this.playwrightService.scrapeTable(url, config.selectors.specifications.container, config.selectors.specifications.item || 'tr', config.selectors.specifications.key || 'td:first-child', config.selectors.specifications.value || 'td:last-child');
        }
        const images = scrapedData['images']
            ? Array.isArray(scrapedData['images'])
                ? scrapedData['images']
                : [scrapedData['images']]
            : [];
        return {
            name: scrapedData['name'] || 'Unknown',
            price: this.parsePrice(scrapedData['price']),
            oldPrice: this.parsePrice(scrapedData['oldPrice']),
            currency: 'BYN',
            brand: scrapedData['brand'],
            model: scrapedData['model'],
            article: scrapedData['article'],
            barcode: scrapedData['barcode'],
            description: scrapedData['description'],
            inStock: this.extractStockStatusFromText(scrapedData['inStock']),
            stockQuantity: this.parseNumber(scrapedData['stockQuantity']),
            availabilityText: scrapedData['inStock'],
            weight: this.parseNumber(scrapedData['weight']),
            dimensions: this.extractDimensions(scrapedData['dimensions']),
            images,
            mainImage: images[0] || scrapedData['mainImage'],
            specifications,
            features: scrapedData['features']
                ? Array.isArray(scrapedData['features'])
                    ? scrapedData['features']
                    : [scrapedData['features']]
                : [],
            countryOfOrigin: scrapedData['countryOfOrigin'],
            warranty: scrapedData['warranty'],
            manufacturer: scrapedData['manufacturer'],
            sourceUrl: url,
            sourceId: this.extractSourceId(url),
        };
    }
    extractProductData($, config, url) {
        const extractText = (selector) => {
            if (!selector)
                return undefined;
            const el = $(selector);
            if (el.length === 0)
                return undefined;
            return el.text()?.trim() || el.attr('content')?.trim();
        };
        const extractNumber = (selector) => {
            const text = extractText(selector);
            if (!text)
                return undefined;
            const cleaned = text.replace(/[^\d,.]/g, '').replace(',', '.');
            return parseFloat(cleaned) || undefined;
        };
        const extractAllText = (selector) => {
            if (!selector)
                return [];
            const result = [];
            $(selector).each((_, el) => {
                const text = $(el).text().trim();
                if (text)
                    result.push(text);
            });
            return result;
        };
        const extractImages = (selector) => {
            if (!selector)
                return [];
            const result = [];
            $(selector).each((_, el) => {
                const src = $(el).attr('src') ||
                    $(el).attr('data-src') ||
                    $(el).find('img').attr('src');
                if (src) {
                    const fullUrl = this.resolveUrl(src, config.baseUrl || url);
                    result.push(fullUrl);
                }
            });
            return result;
        };
        const extractSpecifications = () => {
            const specConfig = config.selectors.specifications;
            if (!specConfig?.container)
                return undefined;
            const specs = {};
            $(specConfig.container).each((_, row) => {
                const key = specConfig.key
                    ? $(row).find(specConfig.key).text().trim()
                    : $(row).children().first().text().trim();
                const value = specConfig.value
                    ? $(row).find(specConfig.value).text().trim()
                    : $(row).children().last().text().trim();
                if (key && value) {
                    specs[key] = value;
                }
            });
            return Object.keys(specs).length > 0 ? specs : undefined;
        };
        const images = extractImages(config.selectors.images);
        return {
            name: extractText(config.selectors.name) || 'Unknown',
            price: extractNumber(config.selectors.price),
            oldPrice: extractNumber(config.selectors.oldPrice),
            currency: 'BYN',
            brand: extractText(config.selectors.brand),
            model: extractText(config.selectors.model),
            article: extractText(config.selectors.article),
            barcode: extractText(config.selectors.barcode),
            description: extractText(config.selectors.description),
            inStock: this.extractStockStatus($, config.selectors.inStock),
            stockQuantity: extractNumber(config.selectors.stockQuantity),
            availabilityText: extractText(config.selectors.inStock),
            weight: extractNumber(config.selectors.weight),
            dimensions: this.extractDimensions(extractText(config.selectors.dimensions)),
            images,
            mainImage: images[0] || extractText(config.selectors.mainImage),
            specifications: extractSpecifications(),
            features: extractAllText(config.selectors.features),
            countryOfOrigin: extractText(config.selectors.countryOfOrigin),
            warranty: extractText(config.selectors.warranty),
            manufacturer: extractText(config.selectors.manufacturer),
            sourceUrl: url,
            sourceId: this.extractSourceId(url),
        };
    }
    parsePrice(text) {
        if (!text)
            return undefined;
        const cleaned = text.replace(/[^\d,.]/g, '').replace(',', '.');
        return parseFloat(cleaned) || undefined;
    }
    parseNumber(text) {
        if (!text)
            return undefined;
        const cleaned = text.replace(/[^\d,.]/g, '').replace(',', '.');
        return parseFloat(cleaned) || undefined;
    }
    extractStockStatus($, selector) {
        if (!selector)
            return false;
        const text = $(selector).text().toLowerCase();
        const inStockPatterns = [
            'в наличии',
            'in stock',
            'есть в наличии',
            'доступно',
            'available',
        ];
        return inStockPatterns.some((pattern) => text.includes(pattern));
    }
    extractStockStatusFromText(text) {
        if (!text)
            return false;
        const inStockPatterns = [
            'в наличии',
            'in stock',
            'есть в наличии',
            'доступно',
            'available',
        ];
        return inStockPatterns.some((pattern) => text.toLowerCase().includes(pattern));
    }
    extractDimensions(text) {
        if (!text)
            return undefined;
        const match = text.match(/([\d.,]+)\s*[xх×]\s*([\d.,]+)\s*[xх×]\s*([\d.,]+)/);
        if (match) {
            return {
                length: parseFloat(match[1].replace(',', '.')),
                width: parseFloat(match[2].replace(',', '.')),
                height: parseFloat(match[3].replace(',', '.')),
            };
        }
        return undefined;
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
    extractSourceId(url) {
        const patterns = [
            /\/product\/(\d+)/,
            /\/p\/(\d+)/,
            /id=(\d+)/,
            /product_id=(\d+)/,
            /\/([^/]+)\.html$/,
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return undefined;
    }
    async clickTabsOnPage(page, tabs) {
        const tabSelectors = tabs || [
            '.tab-link',
            '.tab-button',
            '[role="tab"]',
            '.nav-tabs a',
            '.tabs a',
            '[data-toggle="tab"]',
            '.accordion-header',
        ];
        for (const selector of tabSelectors) {
            try {
                const tabs = await page.$$(selector);
                for (const tab of tabs) {
                    try {
                        await tab.click({ timeout: 2000 });
                        await page.waitForTimeout(500);
                    }
                    catch {
                    }
                }
            }
            catch {
            }
        }
    }
    getDefaultConfigForSite(siteName) {
        const configs = {
            'tools.by': {
                usePlaywright: true,
                waitForSelector: 'h1',
                waitForTimeout: 2000,
                selectors: {
                    name: 'h1',
                    price: '[data-test="product-price-current"], .ProductPrice__current',
                    brand: '[data-test="product-brand"] a, .ProductCardInfo__brand',
                    article: '[data-test="product-article"], .ProductCardInfo__article',
                    inStock: '[data-test="product-stock"], .ProductStock',
                    specifications: {
                        container: '[data-test="product-specs"] table, .ProductSpecs table',
                        item: 'tr',
                        key: 'td:first-child',
                        value: 'td:last-child',
                    },
                    images: '.ProductGallery img, .product-gallery img',
                    description: '.product-description',
                },
            },
            'th-tool.by': {
                usePlaywright: true,
                waitForSelector: 'h1',
                waitForTimeout: 2000,
                selectors: {
                    name: 'h1',
                    price: '.price-value, .price',
                    brand: '.brand-name, .brand',
                    article: '.article, .sku',
                    inStock: '.stock-status, .availability',
                    specifications: {
                        container: '.specs-table, .characteristics',
                        item: 'tr',
                        key: 'td:first-child',
                        value: 'td:last-child',
                    },
                    images: '.product-images img',
                    description: '.product-full-description',
                },
            },
        };
        return (configs[siteName] || {
            usePlaywright: false,
            selectors: {
                name: 'h1',
                price: '.price',
                images: 'img',
            },
        });
    }
};
exports.ParserService = ParserService;
exports.ParserService = ParserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [playwright_service_1.PlaywrightService])
], ParserService);
//# sourceMappingURL=parser.service.js.map