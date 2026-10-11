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
  const inFlight = new Set<string>()
  const pending = usePendingIds()
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Asks for these ids on the next tick. A grid of 24 cards each asking for
   * itself becomes one request, so components can stay dumb about batching.
   */
  function queue(productIds: string[]) {
    if (!isAdmin.value) return
    for (const id of productIds) pending.add(id)
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      const ids = [...pending]
      pending.clear()
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
   * Cheapest in-stock offer first inside a group — that is the one the price
   * comes from, so it is the one worth reading first.
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
          || (a.price ?? Infinity) - (b.price ?? Infinity)
      )
    }

    return [...groups.values()]
  }

  /** "th-tool.by ×2, tools.by" — what the badge shows when space is tight. */
  function labelFor(productId: string) {
    return groupedFor(productId)
      .map(group => (group.offers.length > 1
        ? `${group.sourceName} ×${group.offers.length}`
        : group.sourceName))
      .join(', ')
  }

  return { isAdmin, queue, load, sourcesFor, groupedFor, labelFor }
}

/**
 * The batching buffer lives outside the composable's reactive state: it is
 * transport bookkeeping, not something a component should render, and every
 * caller must share one buffer for the batching to work.
 */
let pendingIds: Set<string> | undefined
function usePendingIds() {
  pendingIds ??= new Set<string>()
  return pendingIds
}
