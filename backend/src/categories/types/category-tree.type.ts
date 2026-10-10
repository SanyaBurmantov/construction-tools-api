export type CategoryTreeNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
  image: string | null;
  /** Admin ordering; lower first. See `Category.sortOrder`. */
  sortOrder: number;
  /** Admin flag: hidden branches are pruned from every storefront listing. */
  isVisible: boolean;
  /** Admin flag: pinned into the home page category grid. */
  isFeatured: boolean;
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
    image: string | null;
    productCount: number;
  }>;
};
