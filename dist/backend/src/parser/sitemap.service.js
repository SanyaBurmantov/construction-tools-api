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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SitemapService = void 0;
const common_1 = require("@nestjs/common");
const playwright_service_1 = require("./playwright.service");
let SitemapService = class SitemapService {
    playwrightService;
    constructor(playwrightService) {
        this.playwrightService = playwrightService;
    }
    async parseSitemap(url) {
        const result = {
            sitemaps: [],
            urls: [],
        };
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'application/xml,text/xml',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch sitemap: ${response.status}`);
            }
            const xml = await response.text();
            return this.extractSitemapData(xml, url);
        }
        catch (error) {
            console.error('Sitemap parse error:', error);
            throw error;
        }
    }
    async parseSitemapWithPlaywright(url) {
        const page = await this.playwrightService.getPage();
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 30000,
            });
            const xml = await page.content();
            return this.extractSitemapData(xml, url);
        }
        finally {
            await page.close();
        }
    }
    extractSitemapData(xml, baseUrl) {
        const result = {
            sitemaps: [],
            urls: [],
        };
        const sitemapIndexMatch = xml.match(/<sitemapindex[^>]*>([\s\S]*?)<\/sitemapindex>/i);
        if (sitemapIndexMatch) {
            const sitemapMatches = xml.matchAll(/<sitemap[^>]*>([\s\S]*?)<\/sitemap>/gi);
            for (const match of sitemapMatches) {
                const locMatch = match[1].match(/<loc[^>]*>([^<]*)<\/loc>/i);
                if (locMatch) {
                    result.sitemaps.push(locMatch[1].trim());
                }
            }
        }
        else {
            const urlMatches = xml.matchAll(/<url[^>]*>([\s\S]*?)<\/url>/gi);
            for (const match of urlMatches) {
                const urlData = {
                    loc: '',
                    lastmod: undefined,
                    changefreq: undefined,
                    priority: undefined,
                };
                const locMatch = match[1].match(/<loc[^>]*>([^<]*)<\/loc>/i);
                if (locMatch) {
                    urlData.loc = locMatch[1].trim();
                }
                const lastmodMatch = match[1].match(/<lastmod[^>]*>([^<]*)<\/lastmod>/i);
                if (lastmodMatch) {
                    urlData.lastmod = lastmodMatch[1].trim();
                }
                const changefreqMatch = match[1].match(/<changefreq[^>]*>([^<]*)<\/changefreq>/i);
                if (changefreqMatch) {
                    urlData.changefreq = changefreqMatch[1].trim();
                }
                const priorityMatch = match[1].match(/<priority[^>]*>([^<]*)<\/priority>/i);
                if (priorityMatch) {
                    urlData.priority = priorityMatch[1].trim();
                }
                if (urlData.loc) {
                    result.urls.push(urlData);
                }
            }
        }
        return result;
    }
    async parseSitemapRecursive(url, maxDepth = 3) {
        const allUrls = [];
        const visited = new Set();
        const processSitemap = async (sitemapUrl, depth) => {
            if (depth > maxDepth || visited.has(sitemapUrl)) {
                return;
            }
            visited.add(sitemapUrl);
            console.log(`Processing sitemap (${depth}/${maxDepth}): ${sitemapUrl}`);
            try {
                const result = await this.parseSitemap(sitemapUrl);
                for (const sitemap of result.sitemaps) {
                    await processSitemap(sitemap, depth + 1);
                }
                allUrls.push(...result.urls);
            }
            catch (error) {
                console.error(`Failed to process ${sitemapUrl}:`, error);
            }
        };
        await processSitemap(url, 0);
        console.log(`Total URLs collected: ${allUrls.length}`);
        return allUrls;
    }
    filterUrlsByPattern(urls, pattern) {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        return urls.filter((url) => regex.test(url.loc));
    }
    groupUrlsByCategory(urls) {
        const groups = {};
        for (const url of urls) {
            try {
                const urlObj = new URL(url.loc);
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                const category = pathParts[0] || 'root';
                if (!groups[category]) {
                    groups[category] = [];
                }
                groups[category].push(url);
            }
            catch {
                if (!groups['invalid']) {
                    groups['invalid'] = [];
                }
                groups['invalid'].push(url);
            }
        }
        return groups;
    }
};
exports.SitemapService = SitemapService;
exports.SitemapService = SitemapService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [playwright_service_1.PlaywrightService])
], SitemapService);
//# sourceMappingURL=sitemap.service.js.map