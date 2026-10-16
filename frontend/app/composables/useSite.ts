/**
 * Site origin and API base, resolved once instead of in every page.
 *
 * - `siteUrl` — the public origin without a trailing slash, for canonicals,
 *   og:url and JSON-LD.
 * - `apiBase` — `API_BASE_SERVER` during SSR (straight to the backend),
 *   `/api` in the browser.
 */
export function useSite() {
  const config = useRuntimeConfig()
  const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')
  const apiBase = import.meta.server
    ? String(config.apiBaseServer)
    : String(config.public.apiBase)
  return { siteUrl, apiBase, absoluteUrl: (path: string) => `${siteUrl}${path}` }
}

/**
 * Title, description, Open Graph and canonical for a page in one call.
 * `title` is the bare page name; the « | Gost.by» suffix is added here.
 */
export function usePageSeo(options: {
  title: string
  description: string
  path: string
  image?: string
  robots?: string
}) {
  const { absoluteUrl } = useSite()
  const title = `${options.title} | Gost.by`
  const url = absoluteUrl(options.path)
  useSeoMeta({
    title,
    description: options.description,
    ogTitle: title,
    ogDescription: options.description,
    ogUrl: url,
    ogType: 'website',
    ...(options.image ? { ogImage: options.image } : {}),
    ...(options.robots ? { robots: options.robots } : {}),
  })
  useHead({ link: [{ rel: 'canonical', href: url }] })
}
