import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'
import { useCompareStore, COMPARE_LIMIT } from '~/stores/compare'

/** The product shape the storefront cards and detail page share. */
export interface CatalogProduct {
  id: string
  slug: string
  name: string
  sku?: string | null
  priceValue?: number | null
  oldPrice?: number | null
  priceCurrency?: string | null
  stockStatus?: string | null
  ratingAvg?: number | null
  ratingCount?: number | null
  brand?: { id?: string, name: string, slug?: string } | null
  category?: { id?: string, name: string, slug?: string } | null
  images?: Array<{ url: string, alt?: string | null }>
  productSpecs?: Array<{ name: string, value: string }>
  stockQuantity?: number | null
  /** Offer count as the product *list* returns it. */
  offerCount?: number
  /** Offer summary as the product *detail* endpoint returns it. */
  offers?: { count: number, inStockCount: number }
}

/**
 * Cart / wishlist / compare actions plus the derived display state every
 * product surface needs. Keeps toast wording consistent across the storefront.
 */
export function useProductActions(product: MaybeRefOrGetter<CatalogProduct>) {
  const cart = useCartStore()
  const wishlist = useWishlistStore()
  const compare = useCompareStore()
  const toast = useAppToast()
  const { normalizeCurrency } = useFormatPrice()

  const item = computed(() => toValue(product))
  const image = computed(() => item.value.images?.[0]?.url ?? null)
  const currency = computed(() => normalizeCurrency(item.value.priceCurrency))

  const canBuy = computed(
    () => item.value.priceValue != null && item.value.priceValue > 0
  )
  const hasDiscount = computed(
    () =>
      item.value.oldPrice != null &&
      item.value.priceValue != null &&
      item.value.oldPrice > item.value.priceValue
  )
  const discountPercent = computed(() =>
    hasDiscount.value
      ? Math.round((1 - item.value.priceValue! / item.value.oldPrice!) * 100)
      : 0
  )
  const inStock = computed(() => item.value.stockStatus === 'in_stock')

  /**
   * Availability with a number when we know one — "В наличии 7 шт." answers the
   * question a bare "В наличии" leaves open, which is what buyers actually
   * check before adding to cart.
   */
  const availabilityLabel = computed(() => {
    const quantity = item.value.stockQuantity
    if (item.value.stockStatus === 'in_stock') {
      if (quantity != null && quantity > 0) {
        return quantity > 10 ? 'В наличии' : `В наличии ${quantity} шт.`
      }
      return 'В наличии'
    }
    if (item.value.stockStatus === 'out_of_stock') return 'Под заказ'
    return 'Уточняйте наличие'
  })

  /**
   * Several suppliers carry this item, so the shown price is the best of them —
   * rendered as "от X", the convention Belarusian catalogues use.
   */
  // The list and detail endpoints report this differently; accept both so the
  // card and the product page agree.
  const offerCount = computed(
    () => item.value.offerCount ?? item.value.offers?.count ?? 0
  )
  const hasMultipleOffers = computed(() => offerCount.value > 1)

  const isFavourite = computed(() => wishlist.has(item.value.id))
  const isComparing = computed(() => compare.has(item.value.id))
  const inCart = computed(() => cart.items.some((i) => i.productId === item.value.id))

  function addToCart(quantity = 1) {
    if (!canBuy.value) return
    cart.add(
      {
        productId: item.value.id,
        slug: item.value.slug,
        name: item.value.name,
        sku: item.value.sku ?? null,
        image: image.value,
        price: item.value.priceValue as number,
        currency: currency.value,
      },
      quantity
    )
    toast.success(`«${item.value.name}» в корзине`)
  }

  function toggleWishlist() {
    const added = wishlist.toggle({
      productId: item.value.id,
      slug: item.value.slug,
      name: item.value.name,
      image: image.value,
      price: item.value.priceValue ?? null,
      oldPrice: item.value.oldPrice ?? null,
      currency: currency.value,
    })
    toast.push(added ? 'Добавлено в избранное' : 'Удалено из избранного', {
      tone: added ? 'success' : 'info',
    })
  }

  function toggleCompare() {
    const result = compare.toggle({
      productId: item.value.id,
      slug: item.value.slug,
      name: item.value.name,
      image: image.value,
      price: item.value.priceValue ?? null,
      oldPrice: item.value.oldPrice ?? null,
      currency: currency.value,
      categorySlug: item.value.category?.slug ?? null,
      categoryName: item.value.category?.name ?? null,
    })

    if (result === 'full') {
      toast.warning(`Можно сравнивать не больше ${COMPARE_LIMIT} товаров`)
    } else {
      toast.push(
        result === 'added' ? 'Добавлено к сравнению' : 'Убрано из сравнения',
        { tone: result === 'added' ? 'success' : 'info' }
      )
    }
  }

  return {
    image,
    currency,
    canBuy,
    inStock,
    availabilityLabel,
    offerCount,
    hasMultipleOffers,
    hasDiscount,
    discountPercent,
    isFavourite,
    isComparing,
    inCart,
    addToCart,
    toggleWishlist,
    toggleCompare,
  }
}
