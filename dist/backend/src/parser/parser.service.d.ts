import { PlaywrightService } from './playwright.service';
export interface ParsedProduct {
    name: string;
    price?: number;
    oldPrice?: number;
    currency?: string;
    brand?: string;
    model?: string;
    article?: string;
    barcode?: string;
    description?: string;
    inStock?: boolean;
    stockQuantity?: number;
    availabilityText?: string;
    weight?: number;
    dimensions?: Record<string, any>;
    images?: string[];
    mainImage?: string;
    specifications?: Record<string, any>;
    features?: string[];
    countryOfOrigin?: string;
    warranty?: string;
    manufacturer?: string;
    categoryId?: string;
    sourceUrl: string;
    sourceId?: string;
}
export interface ParserConfig {
    selectors: {
        name?: string;
        price?: string;
        oldPrice?: string;
        brand?: string;
        model?: string;
        article?: string;
        barcode?: string;
        description?: string;
        inStock?: string;
        stockQuantity?: string;
        weight?: string;
        dimensions?: string;
        images?: string;
        mainImage?: string;
        specifications?: {
            container?: string;
            item?: string;
            key?: string;
            value?: string;
        };
        features?: string;
        countryOfOrigin?: string;
        warranty?: string;
        manufacturer?: string;
        categoryId?: string;
        tabs?: string[];
    };
    pricePattern?: string;
    baseUrl?: string;
    usePlaywright?: boolean;
    waitForSelector?: string;
    waitForTimeout?: number;
    clickTabs?: boolean;
}
export declare class ParserService {
    private playwrightService;
    constructor(playwrightService: PlaywrightService);
    parseHtml(html: string, config: ParserConfig, url: string): Promise<ParsedProduct>;
    parseWithPlaywright(url: string, config: ParserConfig): Promise<ParsedProduct>;
    private extractProductData;
    private parsePrice;
    private parseNumber;
    private extractStockStatus;
    private extractStockStatusFromText;
    private extractDimensions;
    private resolveUrl;
    private extractSourceId;
    private clickTabsOnPage;
    getDefaultConfigForSite(siteName: string): ParserConfig;
}
