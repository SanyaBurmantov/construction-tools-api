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
exports.ParserJobQueueService = void 0;
const common_1 = require("@nestjs/common");
const parser_job_service_1 = require("./parser-job.service");
const source_websites_service_1 = require("../source-websites/source-websites.service");
let ParserJobQueueService = class ParserJobQueueService {
    parserJobService;
    sourceWebsitesService;
    jobs = new Map();
    runningJobs = new Set();
    constructor(parserJobService, sourceWebsitesService) {
        this.parserJobService = parserJobService;
        this.sourceWebsitesService = sourceWebsitesService;
    }
    async createJob(options) {
        const jobId = this.generateJobId();
        const job = {
            id: jobId,
            name: options.name,
            sitemapUrl: options.sitemapUrl,
            sourceWebsiteId: options.sourceWebsiteId,
            productPattern: options.productPattern,
            status: 'pending',
            maxDepth: options.maxDepth,
            concurrency: options.concurrency,
            delayMs: options.delayMs,
        };
        this.jobs.set(jobId, job);
        this.runJob(jobId).catch(console.error);
        return job;
    }
    getJobStatus(jobId) {
        return this.jobs.get(jobId);
    }
    getAllJobs() {
        return Array.from(this.jobs.values()).sort((a, b) => new Date(b.startedAt || 0).getTime() -
            new Date(a.startedAt || 0).getTime());
    }
    deleteJob(jobId) {
        const job = this.jobs.get(jobId);
        if (job && job.status === 'running') {
            return false;
        }
        return this.jobs.delete(jobId);
    }
    async runJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || this.runningJobs.has(jobId)) {
            return;
        }
        this.runningJobs.add(jobId);
        job.status = 'running';
        job.startedAt = new Date();
        try {
            console.log(`Starting job ${jobId}: ${job.name}`);
            const result = await this.parserJobService.parseProductsFromSitemap(job.sitemapUrl, job.sourceWebsiteId, {
                productPattern: job.productPattern,
                maxDepth: job.maxDepth,
                concurrency: job.concurrency,
                delayMs: job.delayMs,
            });
            job.total = result.total;
            job.success = result.success;
            job.failed = result.failed;
            job.status = 'completed';
            job.completedAt = new Date();
            console.log(`Job ${jobId} completed: ${result.success} success, ${result.failed} failed`);
        }
        catch (error) {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : 'Unknown error';
            job.completedAt = new Date();
            console.error(`Job ${jobId} failed:`, error);
        }
        finally {
            this.runningJobs.delete(jobId);
        }
    }
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
};
exports.ParserJobQueueService = ParserJobQueueService;
exports.ParserJobQueueService = ParserJobQueueService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [parser_job_service_1.ParserJobService,
        source_websites_service_1.SourceWebsitesService])
], ParserJobQueueService);
//# sourceMappingURL=parser-job-queue.service.js.map