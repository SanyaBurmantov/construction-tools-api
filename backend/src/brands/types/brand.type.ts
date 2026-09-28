export type BrandSEO = {
  title: string;
  description: string;
  keywords?: string[];
};

export type TBrand = {
  id: string;

  name: string;

  slug: string;

  description?: string;

  logo?: string;

  country?: string;

  seo: BrandSEO;
};
