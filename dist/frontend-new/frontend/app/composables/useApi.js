export const useApi = () => {
    const config = useRuntimeConfig();
    const apiUrl = config.public.apiUrl;
    const fetchProducts = async (filters = {}) => {
        const params = new URLSearchParams();
        if (filters.page)
            params.append('page', filters.page.toString());
        if (filters.limit)
            params.append('limit', filters.limit.toString());
        if (filters.search)
            params.append('search', filters.search);
        if (filters.brand) {
            if (Array.isArray(filters.brand)) {
                filters.brand.forEach(b => params.append('brand', b));
            }
            else {
                params.append('brand', filters.brand);
            }
        }
        if (filters.categoryId)
            params.append('categoryId', filters.categoryId);
        if (filters.minPrice)
            params.append('minPrice', filters.minPrice.toString());
        if (filters.maxPrice)
            params.append('maxPrice', filters.maxPrice.toString());
        if (filters.inStock !== undefined)
            params.append('inStock', filters.inStock.toString());
        const { data, error } = await useFetch(`${apiUrl}/products?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (error.value) {
            throw createError({
                statusCode: 500,
                message: 'Ошибка при загрузке товаров',
            });
        }
        return data.value;
    };
    const fetchProductBySlug = async (slug) => {
        const { data, error } = await useFetch(`${apiUrl}/products/slug/${slug}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (error.value) {
            throw createError({
                statusCode: 404,
                message: 'Товар не найден',
            });
        }
        return data.value;
    };
    return {
        fetchProducts,
        fetchProductBySlug,
    };
};
//# sourceMappingURL=useApi.js.map