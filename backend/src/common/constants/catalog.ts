/**
 * Slug of the service category parsers fall back to when a product's
 * breadcrumbs can't be resolved.
 *
 * It is created with `isVisible: false` (migration
 * `20261015000000_catalog_quality` hid the existing row), which keeps it out of
 * every storefront listing that respects the flag — the tree, the category
 * facet, search suggestions and a brand's category list. Its products stay
 * published and searchable, and `/catalog/unmapped-supplier-products` and the
 * product URLs keep working, until an admin places them.
 */
export const FALLBACK_CATEGORY_SLUG = 'unmapped-supplier-products';
