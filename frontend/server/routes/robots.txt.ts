import { setResponseHeader } from 'h3'

/**
 * Crawl rules. The catalogue, products, brands and info pages are open; what
 * is closed is either private (account, cart, checkout, admin), personal
 * (favourites, comparison), a duplicate of a catalogue listing (/search), or
 * not a page at all (/api). Those client-rendered screens carry `noindex`
 * too, but only after JavaScript runs, which Yandex often does not do — so
 * the rule lives here.
 *
 * `Clean-param` (Yandex) folds URLs that differ only in tracking tags or the
 * sort order into one, so ad clicks and sorted views are not crawled as
 * separate pages. Google ignores the directive and relies on the canonicals.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')

  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /cart
Disallow: /checkout
Disallow: /account
Disallow: /login
Disallow: /register
Disallow: /verify-email
Disallow: /favorites
Disallow: /compare
Disallow: /search
Disallow: /api/

User-agent: Yandex
Allow: /
Disallow: /admin
Disallow: /cart
Disallow: /checkout
Disallow: /account
Disallow: /login
Disallow: /register
Disallow: /verify-email
Disallow: /favorites
Disallow: /compare
Disallow: /search
Disallow: /api/
Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&fbclid&_openstat
Clean-param: sort /catalog
Clean-param: sort /brand

Sitemap: ${siteUrl}/sitemap.xml
`

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return body
})
