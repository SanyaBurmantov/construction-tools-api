import { ParserJobService } from './parser-job.service';
import { ParserService } from './parser.service';
import { ParserJobQueueService } from './parser-job-queue.service';
export declare class ParserController {
    private readonly parserJobService;
    private readonly parserService;
    private readonly parserJobQueue;
    constructor(parserJobService: ParserJobService, parserService: ParserService, parserJobQueue: ParserJobQueueService);
    parseUrl(url: string, sourceWebsiteId?: string): Promise<import("./parser-job.service").ParseResult>;
    parseBatch(urls: string[], sourceWebsiteId?: string): Promise<import("./parser-job.service").ParseResult[]>;
    previewParse(url: string, sourceWebsiteId?: string): Promise<import("./parser-job.service").ParseResult>;
    parseCategory(url: string, sourceWebsiteId: string): Promise<{
        productUrls: string[];
        error?: string;
    }>;
    parseSitemap(sitemapUrl: string, productPattern?: string, maxDepth?: number): Promise<import("./parser-job.service").SitemapParseResult>;
    parseProductsFromSitemap(sitemapUrl: string, sourceWebsiteId?: string, productPattern?: string, maxDepth?: number, concurrency?: number, delayMs?: number): Promise<import("./parser-job.service").MassParseResult>;
    previewSitemap(sitemapUrl: string, limit?: number): Promise<{
        totalUrls: number;
        previewUrls: string[];
        sitemaps: string[];
    }>;
    startJob(name: string, sitemapUrl: string, sourceWebsiteId?: string, productPattern?: string, concurrency?: number, delayMs?: number): Promise<import("./parser-job-queue.service").ParserJob>;
    getAllJobs(): Promise<import("./parser-job-queue.service").ParserJob[]>;
    getJobStatus(jobId: string): Promise<import("./parser-job-queue.service").ParserJob | {
        message: string;
    }>;
    deleteJob(jobId: string): Promise<{
        success: boolean;
    }>;
    parseProductsWithCategories(sitemapUrl: string, sourceWebsiteId?: string, concurrency?: number, delayMs?: number): Promise<import("./parser-job.service").MassParseResult>;
}
