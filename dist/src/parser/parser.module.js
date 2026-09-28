"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserModule = void 0;
const common_1 = require("@nestjs/common");
const parser_service_1 = require("./parser.service");
const parser_job_service_1 = require("./parser-job.service");
const parser_controller_1 = require("./parser.controller");
const playwright_service_1 = require("./playwright.service");
const sitemap_service_1 = require("./sitemap.service");
const parser_job_queue_service_1 = require("./parser-job-queue.service");
const source_websites_module_1 = require("../source-websites/source-websites.module");
const products_module_1 = require("../products/products.module");
const categories_module_1 = require("../categories/categories.module");
let ParserModule = class ParserModule {
};
exports.ParserModule = ParserModule;
exports.ParserModule = ParserModule = __decorate([
    (0, common_1.Module)({
        imports: [
            source_websites_module_1.SourceWebsitesModule,
            products_module_1.ProductsModule,
            categories_module_1.CategoriesModule,
        ],
        controllers: [parser_controller_1.ParserController],
        providers: [parser_service_1.ParserService, parser_job_service_1.ParserJobService, playwright_service_1.PlaywrightService, sitemap_service_1.SitemapService, parser_job_queue_service_1.ParserJobQueueService],
        exports: [parser_service_1.ParserService, parser_job_service_1.ParserJobService, playwright_service_1.PlaywrightService, sitemap_service_1.SitemapService, parser_job_queue_service_1.ParserJobQueueService],
    })
], ParserModule);
//# sourceMappingURL=parser.module.js.map