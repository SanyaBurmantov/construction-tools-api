import { setResponseHeader } from 'h3'

type ProductEntry = { slug: string, updatedAt?: string | null }
type SitemapUrl = { loc: string, lastmod?: string }

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toLastmod(value?: string | null) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const apiBase = String(config.apiBaseServer).replace(/\/$/, '')
  const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')

  // Product detail pages are the bulk of the catalog; categories are query-param
  // filters on /catalog (no dedicated routes), so only static pages + products.
  const products = await $fetch<ProductEntry[]>(`${apiBase}/products/sitemap`).catch(
    () => [] as ProductEntry[]
  )

  const urls: SitemapUrl[] = [
    { loc: `${siteUrl}/` },
    { loc: `${siteUrl}/catalog` },
    ...products.map((product) => ({
      loc: `${siteUrl}/product/${product.slug}`,
      lastmod: toLastmod(product.updatedAt)
    }))
  ]

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => {
    const lastmod = url.lastmod ? `\n    <lastmod>${url.lastmod}</lastmod>` : ''
    return `  <url>\n    <loc>${escapeXml(url.loc)}</loc>${lastmod}\n  </url>`
  })
  .join('\n')}
</urlset>
`

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return body
})
