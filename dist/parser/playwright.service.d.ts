import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Page } from 'playwright';
export declare class PlaywrightService implements OnModuleInit, OnModuleDestroy {
    private browser;
    private context;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    getPage(): Promise<Page>;
    fetchPageContent(url: string, options?: {
        waitForSelector?: string;
        waitForTimeout?: number;
        scroll?: boolean;
    }): Promise<string>;
    scrapeWithSelectors(url: string, selectors: Record<string, string>, options?: {
        waitForSelector?: string;
        waitForTimeout?: number;
    }): Promise<Record<string, string | string[]>>;
    scrapeTable(url: string, tableSelector: string, rowSelector: string, keySelector: string, valueSelector: string): Promise<Record<string, string>>;
    screenshot(url: string, outputPath: string): Promise<void>;
}
