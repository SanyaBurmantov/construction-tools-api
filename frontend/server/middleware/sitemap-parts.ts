import { createError, getRequestURL, setResponseHeader } from 'h3'
import {
  categoryUrls,
  getSitemapSnapshot,
  productChunkCount,
  productUrls,
  renderUrlset,
  siteOrigin,
  staticUrls,
} from '../utils/sitemap'

/**
 * The child sitemaps listed by `/sitemap.xml`:
 * `/sitemap-static.xml`, `/sitemap-categories.xml`, `/sitemap-products-N.xml`.
 *
 * A middleware rather than a route file because the router matches whole path
 * segments only — `sitemap-products-[page].xml.ts` would never match — and
 * the files must sit at the site root (see `server/utils/sitemap.ts`). The
 * regex is the only cost for every other request.
 *
 * No route-rule cache here (or on the index): all of them are cut from one
 * in-process snapshot, which is the part worth caching and what keeps the
 * index and the children in agreement.
 */
const PART_RE = /^\/sitemap-(static|categories|products-(\d{1,4}))\.xml$/

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const match = PART_RE.exec(getRequestURL(event).pathname)
  if (!match) return

  const data = await getSitemapSnapshot()
  const origin = siteOrigin()

  let urls
  if (match[1] === 'static') {
    urls = staticUrls(origin)
  } else if (match[1] === 'categories') {
    urls = categoryUrls(origin, data)
  } else {
    const page = Number(match[2])
    if (!Number.isInteger(page) || page < 1 || page > productChunkCount(data)) {
      throw createError({ statusCode: 404, statusMessage: 'Sitemap not found' })
    }
    urls = productUrls(origin, data, page)
  }

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return renderUrlset(urls)
})
