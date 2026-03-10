export type ProductImage = {
  url: string;
  alt?: string;
  order: number;
};

export type ProductPrice = {
  value: number;
  currency: string;

  oldValue?: number;
};

export type ProductStock = {
  status: 'in_stock' | 'out_of_stock' | 'preorder';

  quantity?: number;
};

export type ProductDescription = {
  short?: string;

  full?: string;

  features?: string[];
};

export type ProductSpecification = {
  specId: string;

  value: string;
};

export type ProductSEO = {
  title: string;
  description: string;
  keywords?: string[];
};

export type TProduct = {
  id: string;

  slug: string;

  name: string;

  brandId?: string;
  categoryId: string;

  sku?: string;
  barcode?: string;
  model?: string;

  images: ProductImage[];

  price: ProductPrice;

  stock: ProductStock;

  description: ProductDescription;

  specifications: ProductSpecification[];
  specs: [{name: string, value:string}];
  seo: ProductSEO;
};
