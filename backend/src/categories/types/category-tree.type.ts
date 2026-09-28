export type CategoryTreeNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
  image: string | null;
  /** Published products in this category and all of its descendants. */
  productCount: number;
  children: CategoryTreeNode[];
};

export type CategoryPage = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  level: number;
  seoTitle: string;
  seoDescription: string;
  productCount: number;
  ancestors: Array<{ id: string; name: string; slug: string }>;
  children: Array<{
    id: string;
    name: string;
    slug: string;
    productCount: number;
  }>;
};
