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
exports.FacetFiltersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let FacetFiltersService = class FacetFiltersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createFacetFilterDto) {
        const category = await this.prisma.category.findUnique({
            where: { id: createFacetFilterDto.categoryId },
        });
        if (!category) {
            throw new common_1.NotFoundException(`Category with ID ${createFacetFilterDto.categoryId} not found`);
        }
        return this.prisma.facetFilter.create({
            data: createFacetFilterDto,
            include: {
                category: true,
            },
        });
    }
    async findAll(categoryId) {
        const where = {};
        if (categoryId) {
            where.categoryId = categoryId;
        }
        return this.prisma.facetFilter.findMany({
            where,
            include: {
                category: true,
            },
            orderBy: { sortOrder: 'asc' },
        });
    }
    async findOne(id) {
        const facetFilter = await this.prisma.facetFilter.findUnique({
            where: { id },
            include: {
                category: true,
            },
        });
        if (!facetFilter) {
            throw new common_1.NotFoundException(`Facet filter with ID ${id} not found`);
        }
        return facetFilter;
    }
    async update(id, updateFacetFilterDto) {
        await this.findOne(id);
        return this.prisma.facetFilter.update({
            where: { id },
            data: updateFacetFilterDto,
            include: {
                category: true,
            },
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.facetFilter.delete({
            where: { id },
        });
    }
    async getFiltersForCategory(categoryId) {
        return this.prisma.facetFilter.findMany({
            where: { categoryId, isEnabled: true },
            orderBy: { sortOrder: 'asc' },
        });
    }
    async toggleEnabled(id) {
        const filter = await this.findOne(id);
        return this.prisma.facetFilter.update({
            where: { id },
            data: { isEnabled: !filter.isEnabled },
            include: {
                category: true,
            },
        });
    }
};
exports.FacetFiltersService = FacetFiltersService;
exports.FacetFiltersService = FacetFiltersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FacetFiltersService);
//# sourceMappingURL=facet-filters.service.js.map