import { setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')

  // Keep the catalog crawlable; block admin/cart/checkout (non-indexable, SSR off).
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /cart
Disallow: /checkout

Sitemap: ${siteUrl}/sitemap.xml
`

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return body
})
