import { setResponseHeader } from 'h3'

type ProductEntry = { slug: string, updatedAt?: string | null }
type CategoryTreeNode = { slug: string, children: CategoryTreeNode[] }
type SitemapUrl = { loc: string, lastmod?: string }

function flattenCategories(nodes: CategoryTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.slug, ...flattenCategories(node.children)])
}

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

  const [products, categories] = await Promise.all([
    $fetch<ProductEntry[]>(`${apiBase}/products/sitemap`).catch(
      () => [] as ProductEntry[]
    ),
    $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`).catch(
      () => [] as CategoryTreeNode[]
    )
  ])

  const urls: SitemapUrl[] = [
    { loc: `${siteUrl}/` },
    { loc: `${siteUrl}/catalog` },
    { loc: `${siteUrl}/brand` },
    { loc: `${siteUrl}/delivery` },
    { loc: `${siteUrl}/contacts` },
    { loc: `${siteUrl}/oferta` },
    { loc: `${siteUrl}/privacy` },
    ...flattenCategories(categories).map((slug) => ({
      loc: `${siteUrl}/catalog/${slug}`
    })),
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
