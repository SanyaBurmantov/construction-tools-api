"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightService = void 0;
const common_1 = require("@nestjs/common");
const playwright_1 = require("playwright");
let PlaywrightService = class PlaywrightService {
    browser = null;
    context = null;
    async onModuleInit() {
        try {
            this.browser = await playwright_1.chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                ],
            });
            this.context = await this.browser.newContext({
                viewport: { width: 1920, height: 1080 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            });
        }
        catch (error) {
            console.error('Failed to initialize Playwright:', error);
        }
    }
    async onModuleDestroy() {
        if (this.context) {
            await this.context.close();
        }
        if (this.browser) {
            await this.browser.close();
        }
    }
    async getPage() {
        if (!this.context) {
            throw new Error('Browser context not initialized');
        }
        return this.context.newPage();
    }
    async fetchPageContent(url, options) {
        const page = await this.getPage();
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 30000,
            });
            if (options?.waitForSelector) {
                await page.waitForSelector(options.waitForSelector, {
                    timeout: 10000,
                });
            }
            if (options?.waitForTimeout) {
                await page.waitForTimeout(options.waitForTimeout);
            }
            if (options?.scroll) {
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await page.waitForTimeout(1000);
            }
            const content = await page.content();
            return content;
        }
        finally {
            await page.close();
        }
    }
    async scrapeWithSelectors(url, selectors, options) {
        const page = await this.getPage();
        const result = {};
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 30000,
            });
            if (options?.waitForSelector) {
                await page.waitForSelector(options.waitForSelector, {
                    timeout: 10000,
                });
            }
            if (options?.waitForTimeout) {
                await page.waitForTimeout(options.waitForTimeout);
            }
            for (const [key, selector] of Object.entries(selectors)) {
                try {
                    if (selector.includes('$$')) {
                        const elements = await page.$$(selector.replace('$$', ''));
                        result[key] = await Promise.all(elements.map(async (el) => (await el.textContent()) || ''));
                    }
                    else if (selector.startsWith('xpath=')) {
                        const xpath = selector.replace('xpath=', '');
                        const element = await page.$(`xpath=${xpath}`);
                        if (element) {
                            const text = await element.textContent();
                            if (text && text.trim()) {
                                result[key] = text.trim();
                            }
                        }
                    }
                    else {
                        const element = await page.$(selector);
                        if (element) {
                            let text = await element.textContent();
                            if (!text || !text.trim()) {
                                text = await element.getAttribute('value');
                            }
                            if (!text || !text.trim()) {
                                text = await element.innerHTML();
                            }
                            if (text && text.trim()) {
                                result[key] = text.trim();
                            }
                        }
                    }
                }
                catch (error) {
                    console.warn(`Failed to scrape "${key}" with selector "${selector}":`, error);
                    result[key] = '';
                }
            }
            return result;
        }
        finally {
            await page.close();
        }
    }
    async scrapeTable(url, tableSelector, rowSelector, keySelector, valueSelector) {
        const page = await this.getPage();
        const result = {};
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 30000,
            });
            const rows = await page.$$(rowSelector);
            for (const row of rows) {
                try {
                    const keyElement = await row.$(keySelector);
                    const valueElement = await row.$(valueSelector);
                    if (keyElement && valueElement) {
                        const key = (await keyElement.textContent())?.trim() || '';
                        const value = (await valueElement.textContent())?.trim() || '';
                        if (key) {
                            result[key] = value;
                        }
                    }
                }
                catch (error) {
                    console.warn('Failed to scrape table row:', error);
                }
            }
            return result;
        }
        finally {
            await page.close();
        }
    }
    async screenshot(url, outputPath) {
        const page = await this.getPage();
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 30000,
            });
            await page.screenshot({ path: outputPath, fullPage: true });
        }
        finally {
            await page.close();
        }
    }
};
exports.PlaywrightService = PlaywrightService;
exports.PlaywrightService = PlaywrightService = __decorate([
    (0, common_1.Injectable)()
], PlaywrightService);
//# sourceMappingURL=playwright.service.js.map