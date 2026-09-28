import type { ProductData } from '~/types/product';
interface ProductsResponse {
    data: ProductData[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}
interface ProductsFilters {
    page?: number;
    limit?: number;
    search?: string;
    brand?: string | string[];
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    inStock?: boolean;
}
export declare const useApi: () => {
    fetchProducts: (filters?: ProductsFilters) => Promise<ProductsResponse>;
    fetchProductBySlug: (slug: string) => Promise<ProductData>;
};
export {};
