import { setResponseHeader } from 'h3'
import {
  categoryUrls,
  getSitemapSnapshot,
  latestLastmod,
  productChunkCount,
  productUrls,
  renderSitemapIndex,
  siteOrigin,
  type SitemapUrl,
} from '../utils/sitemap'

/**
 * `/sitemap.xml` is a **sitemap index** — see `server/utils/sitemap.ts` for
 * why, and `server/middleware/sitemap-parts.ts` for the files it lists.
 * robots.txt keeps pointing here; crawlers follow the index on their own.
 *
 * An API outage with no earlier snapshot answers 503 (thrown by
 * `getSitemapSnapshot`), never an index of the static pages alone.
 */
export default defineEventHandler(async (event) => {
  const data = await getSitemapSnapshot()
  const origin = siteOrigin()

  const sitemaps: SitemapUrl[] = [
    { loc: `${origin}/sitemap-static.xml` },
    ...(categoryUrls(origin, data).length ? [{ loc: `${origin}/sitemap-categories.xml` }] : []),
  ]
  const chunks = productChunkCount(data)
  for (let page = 1; page <= chunks; page += 1) {
    sitemaps.push({
      loc: `${origin}/sitemap-products-${page}.xml`,
      lastmod: latestLastmod(productUrls(origin, data, page)),
    })
  }

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return renderSitemapIndex(sitemaps)
})
