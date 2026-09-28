import { PrismaService } from '../prisma/prisma.service';
import { CreateFacetFilterDto } from './dto/create-facet-filter.dto';
import { UpdateFacetFilterDto } from './dto/update-facet-filter.dto';
export declare class FacetFiltersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createFacetFilterDto: CreateFacetFilterDto): Promise<{
        category: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        };
    } & {
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
    }>;
    findAll(categoryId?: string): Promise<({
        category: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        };
    } & {
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
    })[]>;
    findOne(id: string): Promise<{
        category: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        };
    } & {
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
    }>;
    update(id: string, updateFacetFilterDto: UpdateFacetFilterDto): Promise<{
        category: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        };
    } & {
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
    }>;
    remove(id: string): Promise<{
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
    }>;
    getFiltersForCategory(categoryId: string): Promise<{
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
    }[]>;
    toggleEnabled(id: string): Promise<{
        category: {
            name: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            slug: string;
            sourceWebsiteId: string | null;
            parentId: string | null;
            depth: number;
        };
    } & {
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
    }>;
}
