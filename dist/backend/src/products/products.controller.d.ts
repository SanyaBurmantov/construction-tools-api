import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
export declare class ProductsController {
    private readonly productsService;
    constructor(productsService: ProductsService);
    create(createProductDto: CreateProductDto): Promise<any>;
    findAll(page?: number, limit?: number, search?: string, brand?: string | string[], categoryId?: string, minPrice?: number, maxPrice?: number, inStock?: string): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    getFacetOptions(categoryId: string): Promise<Record<string, any>>;
    findOne(id: string): Promise<any>;
    findBySlug(slug: string): Promise<any>;
    update(id: string, updateProductDto: UpdateProductDto): Promise<any>;
    remove(id: string): Promise<any>;
    hardDelete(id: string): Promise<any>;
}
