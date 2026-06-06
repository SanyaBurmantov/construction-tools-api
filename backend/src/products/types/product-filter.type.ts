export interface ProductFilter {
  categoryId?: string;
  brandId?: string;
  priceMin?: number;
  priceMax?: number;
  sortBy?: 'name' | 'price';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}
