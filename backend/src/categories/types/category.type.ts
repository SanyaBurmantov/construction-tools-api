export type CategorySEO = {
  title: string;
  description: string;
  keywords?: string[];
};

export type TCategory = {
  id: string;

  name: string;

  slug: string;

  parentId?: string;

  level: number;

  path: string[];

  description?: string;

  image?: string;

  seo: CategorySEO;

  children?: [];
};
