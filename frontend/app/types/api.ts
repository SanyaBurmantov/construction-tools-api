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
  updatedAt: string
}
