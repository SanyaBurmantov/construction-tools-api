import { getRequestHeader } from 'h3'
import { useEvent } from 'nitropack/runtime'
import { isApiRequest, ssrVisitorHeaders } from '../utils/ssr-visitor'

type Fetch = typeof globalThis.$fetch
type FetchOptions = Parameters<Fetch>[1]

/**
 * Every SSR fetch to our API names the visitor it is rendering for (see
 * `utils/ssr-visitor.ts`): the API's error log then shows the crawler behind
 * a burst instead of this container's address.
 *
 * The page code calls the global `$fetch`, so it is wrapped once here; the
 * request in flight is found through Nitro's async context
 * (`nitro.experimental.asyncContext` in nuxt.config). Outside a request, or
 * for any URL that is not our API, the call goes through untouched.
 */
export default defineNitroPlugin(() => {
  const base = globalThis.$fetch
  const apiBaseServer = String(useRuntimeConfig().apiBaseServer || '')

  function withVisitor(request: unknown, options?: FetchOptions): FetchOptions {
    if (typeof request !== 'string' || !isApiRequest(request, apiBaseServer)) return options
    let event
    try {
      event = useEvent()
    }
    catch {
      return options
    }
    const extra = ssrVisitorHeaders({
      forwardedFor: getRequestHeader(event, 'x-forwarded-for'),
      remoteAddress: event.node.req.socket?.remoteAddress,
      userAgent: getRequestHeader(event, 'user-agent'),
    })
    if (!Object.keys(extra).length) return options
    const headers = new Headers(options?.headers as HeadersInit | undefined)
    for (const [name, value] of Object.entries(extra)) {
      if (!headers.has(name)) headers.set(name, value)
    }
    return { ...options, headers }
  }

  const wrapped = ((request, options) => base(request, withVisitor(request, options))) as Fetch
  wrapped.raw = ((request, options) => base.raw(request, withVisitor(request, options))) as Fetch['raw']
  wrapped.native = base.native
  wrapped.create = base.create
  globalThis.$fetch = wrapped
})
