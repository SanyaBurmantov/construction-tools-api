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
exports.CategoriesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let CategoriesService = class CategoriesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createCategoryDto) {
        const data = { ...createCategoryDto };
        if (createCategoryDto.parentId) {
            const parent = await this.prisma.category.findUnique({
                where: { id: createCategoryDto.parentId },
            });
            if (!parent) {
                throw new common_1.NotFoundException(`Parent category with ID ${createCategoryDto.parentId} not found`);
            }
            data.depth = (parent.depth || 0) + 1;
        }
        return this.prisma.category.create({
            data,
            include: {
                parent: true,
                children: true,
                sourceWebsite: true,
                facetFilters: true,
            },
        });
    }
    async findAll(sourceWebsiteId) {
        const where = {};
        if (sourceWebsiteId) {
            where.sourceWebsiteId = sourceWebsiteId;
        }
        return this.prisma.category.findMany({
            where,
            include: {
                parent: true,
                children: true,
                sourceWebsite: true,
                facetFilters: true,
                _count: {
                    select: { products: true },
                },
            },
            orderBy: { name: 'asc' },
        });
    }
    async getTree(sourceWebsiteId) {
        const categories = await this.findAll(sourceWebsiteId);
        const rootCategories = categories.filter((c) => !c.parentId);
        const buildTree = (parent) => {
            const children = categories.filter((c) => c.parentId === parent.id);
            return {
                ...parent,
                children: children.map((child) => buildTree(child)),
            };
        };
        return rootCategories.map((root) => buildTree(root));
    }
    async findOne(id) {
        const category = await this.prisma.category.findUnique({
            where: { id },
            include: {
                parent: true,
                children: true,
                sourceWebsite: true,
                facetFilters: true,
                products: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                },
                _count: {
                    select: { products: true },
                },
            },
        });
        if (!category) {
            throw new common_1.NotFoundException(`Category with ID ${id} not found`);
        }
        return category;
    }
    async findBySlug(slug) {
        const category = await this.prisma.category.findFirst({
            where: { slug },
            include: {
                parent: true,
                children: true,
                sourceWebsite: true,
                facetFilters: true,
            },
        });
        if (!category) {
            throw new common_1.NotFoundException(`Category with slug ${slug} not found`);
        }
        return category;
    }
    async update(id, updateCategoryDto) {
        await this.findOne(id);
        return this.prisma.category.update({
            where: { id },
            data: updateCategoryDto,
            include: {
                parent: true,
                children: true,
                sourceWebsite: true,
                facetFilters: true,
            },
        });
    }
    async remove(id) {
        await this.findOne(id);
        const children = await this.prisma.category.findMany({
            where: { parentId: id },
        });
        if (children.length > 0) {
            throw new Error(`Cannot delete category with ${children.length} child categories`);
        }
        return this.prisma.category.delete({
            where: { id },
        });
    }
};
exports.CategoriesService = CategoriesService;
exports.CategoriesService = CategoriesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CategoriesService);
//# sourceMappingURL=categories.service.js.map