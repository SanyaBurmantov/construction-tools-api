/**
 * Shapes returned by the backend API, declared once.
 *
 * These used to be re-declared in every page that fetched them (five copies of
 * `Brand`, three of `Banner`…), so a new field in the API had to be added in
 * five files and missing one was invisible to the linter and the build. Add a
 * field here; pages import it.
 *
 * `CatalogProduct` deliberately stays in `composables/useProductActions` and
 * `CategoryNode` in `composables/useCategoryTree` — they live next to the logic
 * that consumes them.
 */
import type { CatalogProduct } from '~/composables/useProductActions'

/** Every paged list endpoint answers with this envelope. */
export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface Paginated<T> {
  data: T[]
  pagination: Pagination
}

export type ProductsResponse = Paginated<CatalogProduct>

/** Recommendation blocks — mirrors the backend's `orders/upsell-source.ts`. */
export const UPSELL_SOURCES = ['accessories', 'consumables', 'fits', 'similar', 'cart', 'packs'] as const
export type UpsellSource = (typeof UPSELL_SOURCES)[number]

/** A stored cart line's source, only if the API knows it (else a 400). */
export function knownUpsellSource(value: unknown): UpsellSource | undefined {
  return UPSELL_SOURCES.includes(value as UpsellSource) ? (value as UpsellSource) : undefined
}

/** Products fitting by a standard (disc 125 mm, Makita LXT, SDS-plus…). */
export interface FitmentGroup extends Paginated<CatalogProduct> {
  key: string
  role: 'PART' | 'TOOL'
  title: string
}

/** Another pack of the same item, priced per piece/kg. */
export interface PackOption {
  id: string
  slug: string
  name: string
  image: string | null
  quantity: number
  unit: 'шт' | 'кг'
  priceValue: number
  priceCurrency: string | null
  unitPrice: number
  stockStatus: string | null
  current: boolean
}

/** Another size of the same line, labelled by the sizes that differ. */
export interface VariantOption {
  id: string
  slug: string
  label: string
  priceValue: number | null
  priceCurrency: string | null
  stockStatus: string | null
  current: boolean
}

/** Separate from product/list payloads; relation evidence stays server-side. */
export interface ProductRecommendations {
  similar: CatalogProduct[]
  accessories: Paginated<CatalogProduct>
  fits: Paginated<CatalogProduct>
  /** A tool's parts by standard, one group per standard. */
  consumables: FitmentGroup[]
  /** A part's tools by standard. */
  compatibleTools: FitmentGroup[]
  packs: PackOption[]
  /** Other sizes of the same line, the current one marked. */
  variants: VariantOption[]
}

export interface CartSuggestion {
  reason: string
  product: CatalogProduct
}

/**
 * A brand as the storefront sees it. Only `id`/`name` are guaranteed: the
 * admin product form, for instance, is served a bare `{ id, name }` list.
 */
export interface Brand {
  id: string
  name: string
  slug?: string | null
  logo?: string | null
  country?: string | null
  _count?: { products: number }
}

/** `/admin/brands` — the editable row, SEO fields and all. */
export interface AdminBrand extends Brand {
  slug: string
  description: string | null
  country: string | null
  logo: string | null
  seoTitle: string
  seoDescription: string
}

export interface BrandCategory {
  id: string
  name: string
  slug?: string | null
  count: number
}

export interface BrandCategoriesResponse {
  brand: Brand
  categories: BrandCategory[]
}

/** A home-page hero banner, as the public endpoint serves it. */
export interface Banner {
  id: string
  title: string
  subtitle: string | null
  imageUrl: string
  mobileUrl: string | null
  linkUrl: string | null
  buttonText: string | null
  bgColor: string | null
}

/** `/admin/banners` — the same banner plus its scheduling and ordering. */
export interface AdminBanner extends Banner {
  order: number
  isActive: boolean
  startsAt: string | null
  endsAt: string | null
}

/**
 * Mirrors the Prisma `OrderStatus` enum exactly. It used to carry a
 * `COMPLETED` that the database has never had: filtering by it or setting it
 * was a 400 from the DTO, and the two statuses that do exist (`PROCESSING`,
 * `DELIVERED`) rendered as an empty badge with no way to move an order on.
 */
export type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'

export type DeliveryMethod = 'PICKUP' | 'COURIER' | 'POST'

export type PaymentMethod = 'CASH' | 'CARD' | 'INVOICE'

/**
 * A line of an order. Name, slug, image and price are a snapshot taken when the
 * order was placed, so they stay readable after the product changes.
 */
export interface OrderItem {
  id: string
  /** Null once the product has been deleted from the catalogue. */
  productId: string | null
  productName: string
  productSlug: string
  productSku: string | null
  productImage: string | null
  unitPrice: number
  /** Absent from the account's own projection of an order. */
  unitOldPrice?: number | null
  quantity: number
  lineTotal: number
}

/** The order fields every consumer gets: the account's history and admin alike. */
export interface Order {
  id: string
  number: number
  status: OrderStatus
  currency: string
  itemsTotal: number
  deliveryCost: number
  discountTotal: number
  total: number
  promoCodeLabel: string | null
  deliveryMethod: DeliveryMethod
  deliveryAddress: string | null
  paymentMethod: PaymentMethod
  /** The organisation billed — a snapshot from checkout; null for a private buyer. */
  payerName?: string | null
  payerTaxId?: string | null
  payerAddress?: string | null
  payerAccount?: string | null
  payerBankName?: string | null
  payerBankBic?: string | null
  comment: string | null
  customerName: string
  customerPhone: string
  customerEmail: string | null
  createdAt: string
  items: OrderItem[]
}

/** Present only when the order was placed from an account, not as a guest. */
export interface OrderAccount {
  id: string
  login: string
  name: string | null
  customerType: 'INDIVIDUAL' | 'COMPANY'
  companyName: string | null
}

/** `/admin/orders` adds who placed it and when it last moved. */
export interface AdminOrder extends Order {
  user: OrderAccount | null
  /** Last non-direct traffic source («yandex / cpc»); null before it was recorded. */
  trafficSource?: string | null
  /** The very first visit's source. */
  firstTrafficSource?: string | null
  updatedAt: string
}

/** One category of a same-named sibling group (`GET /admin/categories/duplicates`). */
export interface DuplicateCategory {
  id: string
  name: string
  slug: string
  isVisible: boolean
  /** Published products in the category and its subtree. */
  productCount: number
  childCount: number
}

/** Same name, same parent: what `POST /admin/categories/duplicates/merge` folds. */
export interface DuplicateCategoryGroup {
  key: string
  name: string
  parent: { id: string, name: string, slug: string } | null
  /** Suggested survivor: the biggest subtree. */
  targetId: string
  categories: DuplicateCategory[]
}

export interface DuplicateCategoriesResponse {
  groups: DuplicateCategoryGroup[]
  totals: { groups: number, redundantCategories: number }
}

/** `GET /admin/stats` — the dashboard figures; the sidebar badges read the same answer. */
export interface AdminStats {
  products: number
  publishedProducts: number
  categories: number
  brands: number
  sources: number
  orders: number
  newOrders: number
  /** Leads (quotes, questions) nobody has picked up yet. */
  newLeads?: number
  pendingReviews: number
  activePromoCodes: number
  priceReviewNeeded: number
  productsWithoutImages: number
  users: number
  admins: number
  /** Server errors of the last 24h — the badge on «Ошибки». */
  recentErrors: number
  revenueTotal: number
  averageOrder: number
  ordersByStatus: Partial<Record<OrderStatus, number>>
  recentOrders: Array<{
    id: string
    number: number
    status: OrderStatus
    customerName: string
    total: number
    currency: string
    createdAt: string
  }>
  salesSeries: Array<{ date: string, orders: number, revenue: number }>
  topProducts: Array<{
    productId: string | null
    name: string
    slug: string
    quantity: number
    revenue: number
  }>
  /** Last 90 days per traffic source («yandex / cpc», «direct»…). */
  bySource?: Array<{ source: string, orders: number, revenue: number, leads: number }>
  /** Last 90 days: what each recommendation block sold (OrderItem.upsellSource). */
  upsell?: {
    totalRevenue: number
    sources: Array<{ source: string, label: string, lines: number, orders: number, revenue: number }>
  }
}

/** An account as `/admin/users` lists it: the profile plus its live session count. */
export type AdminUser = import('~/composables/useAuth').AccountUser & {
  _count?: { sessions: number }
}

/* ---- Storefront catalogue (CatalogView, catalogFilters, product, compare) ---- */

/** A brand / supplier row as a catalogue facet lists it. */
export interface FacetItem {
  id: string
  name: string
  slug?: string
  /** Suppliers only: the `?source=` value. */
  code?: string
}

/** A specification facet: its values with filter-aware counts. */
export interface SpecFacet {
  id: string
  name: string
  unit?: string | null
  group?: string | null
  values: Array<{ value: string, count: number }>
}

/** `GET /products` with the facets the catalogue page reads. */
export interface CatalogProductsResponse extends ProductsResponse {
  facets?: {
    specs?: SpecFacet[]
    /** Category id → products under it; categories that match nothing are absent. */
    categories?: Record<string, number>
    brands?: Record<string, number>
    priceRange?: { min: number, max: number } | null
  }
}

/** `GET /categories/:slug` — a category page with its ancestors and children. */
export interface CategoryPage {
  id: string
  name: string
  slug: string
  description?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  /** false for an admin-hidden branch: its URL works, but it is not indexed */
  isVisible?: boolean
  productCount: number
  ancestors: Array<{ id: string, name: string, slug: string }>
  children: Array<{
    id: string
    name: string
    slug: string
    image?: string | null
    productCount: number
  }>
}

/** `GET /products/:slug` — the product page and the comparison table. */
export type ProductDetail = CatalogProduct & {
  model?: string | null
  descriptionShort?: string | null
  descriptionFull?: string | null
  images?: Array<{ id?: string, url: string, alt?: string | null }>
  /** EAN; suppliers sometimes store a second one as «A (B)». */
  barcode?: string | null
  /** When the price was last checked against a supplier (ISO). */
  priceCheckedAt?: string | null
  /** Ours only (AI task or admin edit); the API nulls a supplier's SEO text. */
  seoTitle?: string | null
  seoDescription?: string | null
}

/** A published review as `GET /products/:slug/reviews` returns it (no account link). */
export type Review = {
  id: string
  authorName: string
  rating: number
  title: string | null
  text: string
  /** The author had a non-cancelled order with this product when they wrote it. */
  isVerifiedPurchase: boolean
  createdAt: string
}
