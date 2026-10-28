/**
 * Sitemap data and XML, shared by `/sitemap.xml` (the index) and the child
 * files served by `server/middleware/sitemap-parts.ts`.
 *
 * Why an index: the single file used to list ~55 000 URLs in 9 MB — over the
 * protocol's 50 000-URL limit, so a crawler may reject it outright. The index
 * points at `sitemap-static.xml`, `sitemap-categories.xml` and
 * `sitemap-products-N.xml` (`PRODUCTS_PER_SITEMAP` URLs each). The child files
 * live at the site root on purpose: a sitemap may only list URLs at or below
 * its own directory, so `/sitemaps/products-1.xml` could not list `/product/…`.
 *
 * Why one snapshot: the expensive part is the backend call (every published
 * slug, ~52k rows), not the XML. It is fetched once and kept in-process for
 * `SNAPSHOT_TTL_MS`, and the index and every child are cut from that same
 * snapshot — so the index never announces a chunk the children disagree
 * about, and a crawler walking six files costs one backend request.
 *
 * Outage rule (unchanged): a failed fetch is never served as a valid, shorter
 * sitemap. With an earlier snapshot in hand, that snapshot keeps being served
 * (it is still the truth as far as we know); with none, the routes answer 503,
 * which a crawler retries and Nitro never caches.
 */
import { createError } from 'h3'

type ProductEntry = { slug: string, updatedAt?: string | null }
type CategoryTreeNode = { slug: string, children?: CategoryTreeNode[] }
export type SitemapUrl = { loc: string, lastmod?: string }

/** Comfortably under the 50 000 limit, and ~1.5 MB of XML per file. */
export const PRODUCTS_PER_SITEMAP = 10_000
const SNAPSHOT_TTL_MS = 60 * 60 * 1000
/** The slug list is one big query; give it room, but never hang a crawler. */
const FETCH_TIMEOUT_MS = 60_000

const STATIC_PATHS = ['/', '/catalog', '/sales', '/brand', '/delivery', '/organizaciyam', '/contacts', '/about', '/garantiya', '/usloviya', '/privacy']

export type SitemapSnapshot = {
  /** Sorted by slug, so a product stays in the same chunk between snapshots. */
  products: Array<{ slug: string, lastmod?: string }>
  categories: string[]
  fetchedAt: number
}

let snapshot: SitemapSnapshot | undefined
let inflight: Promise<SitemapSnapshot> | undefined

function flattenCategories(nodes: CategoryTreeNode[]): string[] {
  return nodes.flatMap(node => [node.slug, ...flattenCategories(node.children || [])])
}

function toLastmod(value?: string | null) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function fetchSnapshot(): Promise<SitemapSnapshot> {
  const config = useRuntimeConfig()
  const apiBase = String(config.apiBaseServer).replace(/\/$/, '')

  // No `?depth=`: the full tree is what the sitemap needs.
  const [products, categories] = await Promise.all([
    $fetch<ProductEntry[]>(`${apiBase}/products/sitemap`, { timeout: FETCH_TIMEOUT_MS }),
    $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`, { timeout: FETCH_TIMEOUT_MS }),
  ])

  if (!Array.isArray(products) || !Array.isArray(categories)) {
    throw new Error('Unexpected sitemap payload from the API')
  }

  return {
    products: products
      .filter(product => product.slug)
      .map(product => ({ slug: product.slug, lastmod: toLastmod(product.updatedAt) }))
      .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)),
    categories: [...new Set(flattenCategories(categories).filter(Boolean))],
    fetchedAt: Date.now(),
  }
}

function refresh() {
  inflight ??= fetchSnapshot()
    .then((fresh) => {
      snapshot = fresh
      return fresh
    })
    .finally(() => {
      inflight = undefined
    })
  return inflight
}

/**
 * The current snapshot. Fresh → returned as is. Stale → returned at once while
 * a refresh runs in the background (a failed refresh keeps the stale one).
 * None → fetched now; a failure is a 503.
 */
export async function getSitemapSnapshot(): Promise<SitemapSnapshot> {
  if (snapshot) {
    if (Date.now() - snapshot.fetchedAt > SNAPSHOT_TTL_MS) {
      refresh().catch((error) => {
        console.error('[sitemap] refresh failed, serving the previous snapshot', error)
      })
    }
    return snapshot
  }

  try {
    return await refresh()
  } catch (error) {
    console.error('[sitemap] API unavailable', error)
    throw createError({ statusCode: 503, statusMessage: 'Sitemap temporarily unavailable' })
  }
}

export function productChunkCount(data: SitemapSnapshot) {
  return Math.max(1, Math.ceil(data.products.length / PRODUCTS_PER_SITEMAP))
}

export function siteOrigin() {
  return String(useRuntimeConfig().public.siteUrl).replace(/\/$/, '')
}

export function staticUrls(origin: string): SitemapUrl[] {
  return STATIC_PATHS.map(path => ({ loc: `${origin}${path}` }))
}

export function categoryUrls(origin: string, data: SitemapSnapshot): SitemapUrl[] {
  return data.categories.map(slug => ({ loc: `${origin}/catalog/${slug}` }))
}

/** `page` is 1-based; an out-of-range page is an empty list. */
export function productUrls(origin: string, data: SitemapSnapshot, page: number): SitemapUrl[] {
  const start = (page - 1) * PRODUCTS_PER_SITEMAP
  return data.products
    .slice(start, start + PRODUCTS_PER_SITEMAP)
    .map(product => ({ loc: `${origin}/product/${product.slug}`, lastmod: product.lastmod }))
}

/** The newest `lastmod` of a chunk — what the index reports for that file. */
export function latestLastmod(urls: SitemapUrl[]) {
  let latest: string | undefined
  for (const url of urls) {
    if (url.lastmod && (!latest || url.lastmod > latest)) latest = url.lastmod
  }
  return latest
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function entry(tag: 'url' | 'sitemap', url: SitemapUrl) {
  const lastmod = url.lastmod ? `\n    <lastmod>${url.lastmod}</lastmod>` : ''
  return `  <${tag}>\n    <loc>${escapeXml(url.loc)}</loc>${lastmod}\n  </${tag}>`
}

export function renderUrlset(urls: SitemapUrl[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => entry('url', url)).join('\n')}
</urlset>
`
}

export function renderSitemapIndex(sitemaps: SitemapUrl[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map(sitemap => entry('sitemap', sitemap)).join('\n')}
</sitemapindex>
`
}
