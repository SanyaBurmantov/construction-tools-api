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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ProductsService = class ProductsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createProductDto) {
        return this.prisma.product.create({
            data: createProductDto,
            include: {
                category: true,
                sourceWebsite: true,
            },
        });
    }
    async findAll(filters, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const where = { isActive: true };
        if (filters?.search) {
            where.OR = [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { brand: { contains: filters.search, mode: 'insensitive' } },
                { model: { contains: filters.search, mode: 'insensitive' } },
                { article: { contains: filters.search, mode: 'insensitive' } },
            ];
        }
        if (filters?.brand && filters.brand.length > 0) {
            where.brand = { in: filters.brand };
        }
        if (filters?.categoryId) {
            where.categoryId = filters.categoryId;
        }
        if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
            where.price = {};
            if (filters.minPrice !== undefined) {
                where.price.gte = filters.minPrice;
            }
            if (filters.maxPrice !== undefined) {
                where.price.lte = filters.maxPrice;
            }
        }
        if (filters?.inStock !== undefined) {
            where.inStock = filters.inStock;
        }
        if (filters?.facets) {
            for (const [key, value] of Object.entries(filters.facets)) {
                if (Array.isArray(value) && value.length > 0) {
                    where.specifications = {
                        path: [key],
                        in: value,
                    };
                }
            }
        }
        const [products, total] = await Promise.all([
            this.prisma.product.findMany({
                where,
                skip,
                take: limit,
                include: {
                    category: true,
                    sourceWebsite: true,
                },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.product.count({ where }),
        ]);
        return {
            data: products,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOne(id) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: {
                category: true,
                sourceWebsite: true,
            },
        });
        if (!product) {
            throw new common_1.NotFoundException(`Product with ID ${id} not found`);
        }
        return product;
    }
    async findBySlug(slug) {
        const product = await this.prisma.product.findFirst({
            where: { slug },
            include: {
                category: true,
                sourceWebsite: true,
            },
        });
        if (!product) {
            throw new common_1.NotFoundException(`Product with slug ${slug} not found`);
        }
        return product;
    }
    async update(id, updateProductDto) {
        await this.findOne(id);
        return this.prisma.product.update({
            where: { id },
            data: updateProductDto,
            include: {
                category: true,
                sourceWebsite: true,
            },
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.product.update({
            where: { id },
            data: { isActive: false },
        });
    }
    async hardDelete(id) {
        await this.findOne(id);
        return this.prisma.product.delete({
            where: { id },
        });
    }
    async getFacetOptions(categoryId) {
        const facetFilters = await this.prisma.facetFilter.findMany({
            where: { categoryId, isEnabled: true },
            orderBy: { sortOrder: 'asc' },
        });
        const options = {};
        for (const filter of facetFilters) {
            const values = await this.prisma.product.findMany({
                where: { categoryId, isActive: true },
                select: {
                    [filter.field]: true,
                },
                distinct: [filter.field],
            });
            options[filter.field] = {
                ...filter,
                values: values.map((v) => v[filter.field]).filter(Boolean),
            };
        }
        return options;
    }
    async upsertBySourceUrl(sourceUrl, createProductDto) {
        const existing = await this.prisma.product.findFirst({
            where: { sourceUrl },
        });
        if (existing) {
            return this.prisma.product.update({
                where: { id: existing.id },
                data: {
                    ...createProductDto,
                    parsedAt: new Date(),
                },
                include: {
                    category: true,
                    sourceWebsite: true,
                },
            });
        }
        return this.prisma.product.create({
            data: {
                ...createProductDto,
                sourceUrl,
            },
            include: {
                category: true,
                sourceWebsite: true,
            },
        });
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map