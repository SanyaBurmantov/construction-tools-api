import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
export declare class CategoriesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createCategoryDto: CreateCategoryDto): Promise<{
        sourceWebsite: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            baseUrl: string;
            parserConfig: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
        parent: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        } | null;
        children: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        }[];
        facetFilters: {
            categoryId: string;
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            type: import(".prisma/client").$Enums.FilterType;
            field: string;
            isEnabled: boolean;
            sortOrder: number;
            config: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
    } & {
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        sourceWebsiteId: string | null;
        parentId: string | null;
        depth: number;
    }>;
    findAll(sourceWebsiteId?: string): Promise<({
        sourceWebsite: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            baseUrl: string;
            parserConfig: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
        parent: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        } | null;
        children: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        }[];
        facetFilters: {
            categoryId: string;
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            type: import(".prisma/client").$Enums.FilterType;
            field: string;
            isEnabled: boolean;
            sortOrder: number;
            config: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
        _count: {
            products: number;
        };
    } & {
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        sourceWebsiteId: string | null;
        parentId: string | null;
        depth: number;
    })[]>;
    getTree(sourceWebsiteId?: string): Promise<any[]>;
    findOne(id: string): Promise<{
        sourceWebsite: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            baseUrl: string;
            parserConfig: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
        products: {
            brand: string | null;
            categoryId: string | null;
            inStock: boolean;
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            slug: string | null;
            model: string | null;
            article: string | null;
            barcode: string | null;
            price: import("@prisma/client/runtime/library").Decimal | null;
            currency: string;
            oldPrice: import("@prisma/client/runtime/library").Decimal | null;
            discount: number | null;
            stockQuantity: number;
            availabilityText: string | null;
            weight: import("@prisma/client/runtime/library").Decimal | null;
            dimensions: import("@prisma/client/runtime/library").JsonValue | null;
            sourceWebsiteId: string | null;
            sourceUrl: string | null;
            sourceId: string | null;
            images: import("@prisma/client/runtime/library").JsonValue | null;
            mainImage: string | null;
            specifications: import("@prisma/client/runtime/library").JsonValue | null;
            features: string[];
            countryOfOrigin: string | null;
            warranty: string | null;
            manufacturer: string | null;
            isActive: boolean;
            parsedAt: Date;
        }[];
        parent: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        } | null;
        children: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        }[];
        facetFilters: {
            categoryId: string;
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            type: import(".prisma/client").$Enums.FilterType;
            field: string;
            isEnabled: boolean;
            sortOrder: number;
            config: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
        _count: {
            products: number;
        };
    } & {
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        sourceWebsiteId: string | null;
        parentId: string | null;
        depth: number;
    }>;
    findBySlug(slug: string): Promise<{
        sourceWebsite: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            baseUrl: string;
            parserConfig: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
        parent: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        } | null;
        children: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        }[];
        facetFilters: {
            categoryId: string;
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            type: import(".prisma/client").$Enums.FilterType;
            field: string;
            isEnabled: boolean;
            sortOrder: number;
            config: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
    } & {
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        sourceWebsiteId: string | null;
        parentId: string | null;
        depth: number;
    }>;
    update(id: string, updateCategoryDto: UpdateCategoryDto): Promise<{
        sourceWebsite: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            baseUrl: string;
            parserConfig: import("@prisma/client/runtime/library").JsonValue | null;
        } | null;
        parent: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        } | null;
        children: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        }[];
        facetFilters: {
            categoryId: string;
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            type: import(".prisma/client").$Enums.FilterType;
            field: string;
            isEnabled: boolean;
            sortOrder: number;
            config: import("@prisma/client/runtime/library").JsonValue | null;
        }[];
    } & {
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        sourceWebsiteId: string | null;
        parentId: string | null;
        depth: number;
    }>;
    remove(id: string): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        slug: string;
        sourceWebsiteId: string | null;
        parentId: string | null;
        depth: number;
    }>;
}
