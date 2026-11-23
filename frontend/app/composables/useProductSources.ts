export type ProductSource = {
  sourceId: string
  sourceName: string
  sourceCode: string
  url: string
  price: number | null
  currency: string | null
  stock: boolean
  lastSync: string
}

/** A supplier and every page of theirs that feeds this product. */
export type ProductSourceGroup = {
  sourceId: string
  sourceName: string
  sourceCode: string
  offers: ProductSource[]
}

/** Shared cache: the catalogue, the product page and the order all ask again. */
const CACHE_KEY = 'admin-product-sources'

/**
 * "Откуда спаршен" — the supplier(s) a product came from, **for admins only**.
 *
 * The data comes from `GET /admin/products/sources`, which is behind
 * `AdminGuard`: supplier URLs and our costs must never reach the storefront,
 * so a regular visitor cannot obtain this even though the storefront renders
 * it for an admin. A non-admin never fires the request at all.
 */
export function useProductSources() {
  const { isAdmin } = useAuth()
  const { adminFetch } = useAdminApi()
  // Keyed by product id; a missing key means "not fetched", an empty array
  // means "fetched, no supplier offers" (a hand-made product).
  const cache = useState<Record<string, ProductSource[]>>(CACHE_KEY, () => ({}))

  /**
   * Asks for these ids on the next tick. A grid of 24 cards each asking for
   * itself becomes one request, so components can stay dumb about batching.
   */
  function queue(productIds: string[]) {
    if (import.meta.server || !isAdmin.value) return
    for (const id of productIds) pendingIds.add(id)
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      const ids = [...pendingIds]
      pendingIds.clear()
      void load(ids)
    }, 50)
  }

  /** Fetches whatever is missing from the cache. Safe to call repeatedly. */
  async function load(productIds: string[]) {
    if (!isAdmin.value) return
    const missing = [...new Set(productIds)].filter(
      id => id && cache.value[id] === undefined && !inFlight.has(id)
    )
    if (!missing.length) return

    for (const id of missing) inFlight.add(id)
    try {
      // The API caps a request at 100 ids; a catalogue page is 24.
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100)
        const response = await adminFetch<Record<string, ProductSource[]>>(
          '/products/sources',
          { params: { ids: chunk.join(',') } }
        )
        cache.value = {
          ...cache.value,
          // Products with no offers are absent from the response — cache the
          // empty answer too, or they are re-requested forever.
          ...Object.fromEntries(chunk.map(id => [id, response[id] ?? []])),
        }
      }
    } catch {
      // Not fatal: the badge simply does not appear.
      for (const id of missing) inFlight.delete(id)
      return
    }
    for (const id of missing) inFlight.delete(id)
  }

  const sourcesFor = (productId: string) => cache.value[productId] ?? []
  /** True once the answer for this id is in — an empty list then means "no offers". */
  const isLoaded = (productId: string) => cache.value[productId] !== undefined

  /**
   * Offers folded by supplier.
   *
   * One product can legitimately carry several offers from the *same* source —
   * the supplier lists the item on more than one page, and a barcode match then
   * folds those pages' products into one card. Rendering the raw list printed
   * the supplier once per offer («th-tool.by, th-tool.by, th-tool.by»), which
   * reads as a bug in the data rather than as "three pages at one supplier".
   * Everything that names a supplier goes through this, so a supplier is named
   * once and its pages hang under it.
   *
   * The offer the price comes from (`pickPriceOffer`) leads: its supplier
   * first, and inside a supplier in-stock pages first, dearest first.
   */
  function groupedFor(productId: string): ProductSourceGroup[] {
    const groups = new Map<string, ProductSourceGroup>()

    for (const offer of sourcesFor(productId)) {
      const group = groups.get(offer.sourceId)
      if (group) group.offers.push(offer)
      else {
        groups.set(offer.sourceId, {
          sourceId: offer.sourceId,
          sourceName: offer.sourceName,
          sourceCode: offer.sourceCode,
          offers: [offer],
        })
      }
    }

    for (const group of groups.values()) {
      group.offers.sort(
        (a, b) =>
          Number(b.stock) - Number(a.stock)
          || (b.price ?? -Infinity) - (a.price ?? -Infinity)
      )
    }

    const priceSource = priceOfferFor(productId)?.sourceId
    return [...groups.values()].sort(
      (a, b) => Number(b.sourceId === priceSource) - Number(a.sourceId === priceSource)
    )
  }

  /** The offer the storefront price is taken from, if any is priced. */
  const priceOfferFor = (productId: string) => pickPriceOffer(sourcesFor(productId))

  /**
   * Several suppliers carry it (a merged card) — the admin screens highlight
   * these, because the price is the dearest of them and the order can be
   * bought from either.
   */
  const isMultiSupplier = (productId: string) =>
    new Set(sourcesFor(productId).map(offer => offer.sourceId)).size > 1

  /** "th-tool.by ×2, tools.by" — what the badge shows when space is tight. */
  function labelFor(productId: string) {
    return groupedFor(productId)
      .map(group => (group.offers.length > 1
        ? `${group.sourceName} ×${group.offers.length}`
        : group.sourceName))
      .join(isMultiSupplier(productId) ? ' + ' : ', ')
  }

  return {
    isAdmin,
    queue,
    load,
    isLoaded,
    sourcesFor,
    groupedFor,
    labelFor,
    priceOfferFor,
    isMultiSupplier,
  }
}

/**
 * The batching bookkeeping lives at module level, outside the reactive state:
 * it is transport, not something a component renders, and every caller must
 * share it. Kept per instance, the timer batched only one card's own ids and
 * `inFlight` could not stop two cards asking for the same product. Client-only
 * — `queue()` never runs during SSR, where module state is shared by requests.
 */
const pendingIds = new Set<string>()
const inFlight = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
