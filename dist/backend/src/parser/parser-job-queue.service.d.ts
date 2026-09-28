import { ParserJobService } from './parser-job.service';
import { SourceWebsitesService } from '../source-websites/source-websites.service';
export interface ParserJob {
    id: string;
    name: string;
    sitemapUrl: string;
    sourceWebsiteId?: string;
    productPattern?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    total?: number;
    success?: number;
    failed?: number;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
    maxDepth?: number;
    concurrency?: number;
    delayMs?: number;
}
export declare class ParserJobQueueService {
    private parserJobService;
    private sourceWebsitesService;
    private jobs;
    private runningJobs;
    constructor(parserJobService: ParserJobService, sourceWebsitesService: SourceWebsitesService);
    createJob(options: {
        name: string;
        sitemapUrl: string;
        sourceWebsiteId?: string;
        productPattern?: string;
        maxDepth?: number;
        concurrency?: number;
        delayMs?: number;
    }): Promise<ParserJob>;
    getJobStatus(jobId: string): ParserJob | undefined;
    getAllJobs(): ParserJob[];
    deleteJob(jobId: string): boolean;
    private runJob;
    private generateJobId;
}
