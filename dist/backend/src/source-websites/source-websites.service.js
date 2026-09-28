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
exports.SourceWebsitesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let SourceWebsitesService = class SourceWebsitesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createSourceWebsiteDto) {
        return this.prisma.sourceWebsite.create({
            data: createSourceWebsiteDto,
            include: {
                products: {
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                },
                categories: true,
                _count: {
                    select: { products: true, categories: true },
                },
            },
        });
    }
    async findAll() {
        return this.prisma.sourceWebsite.findMany({
            include: {
                products: {
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                },
                categories: {
                    take: 10,
                    orderBy: { name: 'asc' },
                },
                _count: {
                    select: { products: true, categories: true },
                },
            },
            orderBy: { name: 'asc' },
        });
    }
    async findOne(id) {
        const sourceWebsite = await this.prisma.sourceWebsite.findUnique({
            where: { id },
            include: {
                products: {
                    orderBy: { createdAt: 'desc' },
                },
                categories: {
                    orderBy: { name: 'asc' },
                },
                _count: {
                    select: { products: true, categories: true },
                },
            },
        });
        if (!sourceWebsite) {
            throw new common_1.NotFoundException(`Source website with ID ${id} not found`);
        }
        return sourceWebsite;
    }
    async findByUrl(baseUrl) {
        const sourceWebsite = await this.prisma.sourceWebsite.findFirst({
            where: { baseUrl },
            include: {
                products: true,
                categories: true,
            },
        });
        if (!sourceWebsite) {
            throw new common_1.NotFoundException(`Source website with URL ${baseUrl} not found`);
        }
        return sourceWebsite;
    }
    async update(id, updateSourceWebsiteDto) {
        await this.findOne(id);
        return this.prisma.sourceWebsite.update({
            where: { id },
            data: updateSourceWebsiteDto,
            include: {
                products: true,
                categories: true,
            },
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.sourceWebsite.delete({
            where: { id },
        });
    }
    async toggleActive(id) {
        const website = await this.findOne(id);
        return this.prisma.sourceWebsite.update({
            where: { id },
            data: { isActive: !website.isActive },
            include: {
                products: true,
                categories: true,
            },
        });
    }
    async getParserConfig(id) {
        const website = await this.findOne(id);
        return website.parserConfig || {};
    }
};
exports.SourceWebsitesService = SourceWebsitesService;
exports.SourceWebsitesService = SourceWebsitesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SourceWebsitesService);
//# sourceMappingURL=source-websites.service.js.map