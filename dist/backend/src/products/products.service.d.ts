import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
interface ProductFilters {
    search?: string;
    brand?: string[];
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    inStock?: boolean;
    facets?: Record<string, any>;
}
export declare class ProductsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createProductDto: CreateProductDto): Promise<any>;
    findAll(filters?: ProductFilters, page?: number, limit?: number): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: string): Promise<any>;
    findBySlug(slug: string): Promise<any>;
    update(id: string, updateProductDto: UpdateProductDto): Promise<any>;
    remove(id: string): Promise<any>;
    hardDelete(id: string): Promise<any>;
    getFacetOptions(categoryId: string): Promise<Record<string, any>>;
    upsertBySourceUrl(sourceUrl: string, createProductDto: CreateProductDto): Promise<any>;
}
export {};
