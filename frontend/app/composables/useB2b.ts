/**
 * What a company buyer gets beyond the cart: the PDF invoice and quote, the
 * XLSX price list, and whether invoices are issued automatically right now
 * (`GET /seller` — they are not until the shop's requisites are complete in
 * /admin/settings; until then the manager sends them).
 */
export type SellerInfo = {
  name: string
  unp: string
  legalAddress: string
  bankAccount: string
  bankName: string
  bankBic: string
  vatMode: 'NONE' | 'INCLUDED' | null
  vatRate: number
  validDays: number
  invoiceReady: boolean
}

/** Saves a blob under a name — the browser's own download, no new tab. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function useB2b() {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase).replace(/\/$/, '')
  const { authFetch } = useAuth()
  const seller = useState<SellerInfo | null>('b2b-seller', () => null)

  /** Client-side, once per visit: the answer changes only when an admin edits it. */
  async function loadSeller() {
    if (seller.value) return seller.value
    try {
      seller.value = await $fetch<SellerInfo>(`${apiBase}/seller`)
    } catch {
      seller.value = null
    }
    return seller.value
  }

  /** The public, UUID-keyed invoice link (same access rule as the order page). */
  const invoiceUrl = (orderId: string) => `${apiBase}/orders/${orderId}/invoice.pdf`

  /** Whether an order can have an invoice at all, seller settings aside. */
  const isInvoiceable = (order: { paymentMethod: string, payerName?: string | null, status?: string }) =>
    order.paymentMethod === 'INVOICE' && Boolean(order.payerName) && order.status !== 'CANCELLED'

  /** A price list link; empty filter = the whole catalogue. */
  function priceListUrl(filter: { categorySlug?: string, brandSlug?: string } = {}) {
    const query = new URLSearchParams()
    if (filter.categorySlug) query.set('categorySlug', filter.categorySlug)
    if (filter.brandSlug) query.set('brandSlug', filter.brandSlug)
    const qs = query.toString()
    return `${apiBase}/price-list.xlsx${qs ? `?${qs}` : ''}`
  }

  /** Downloads a commercial offer for the given lines (re-priced by the API). */
  async function downloadQuote(
    items: Array<{ productId: string, quantity: number }>,
    contact: { companyName?: string, taxId?: string, email?: string } = {}
  ) {
    const blob = await authFetch<Blob>('/documents/quote', {
      method: 'POST',
      body: { items, ...contact, attribution: getAttribution() },
      responseType: 'blob',
    })
    saveBlob(blob, `kommercheskoe-predlozhenie-gost-by.pdf`)
  }

  return { seller, loadSeller, invoiceUrl, isInvoiceable, priceListUrl, downloadQuote }
}
