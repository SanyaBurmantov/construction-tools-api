/**
 * Who a server-side render is fetching for, as headers for the API.
 *
 * SSR fetches reach the backend from this container, so the API saw
 * 172.18.0.7 / «node» for every visitor and crawler: two bursts of 503s on
 * 18.11 could not say whose pages they were. The backend believes these two
 * headers only from inside the Docker network (`common/http/ssr-visitor.ts`)
 * and uses them for its error log only — its throttler keeps reading the peer
 * address, so the SSR exemption from the per-address limit is untouched.
 * Never use X-Forwarded-For for this: with `trust proxy` the API would take
 * it as `req.ip` and start throttling SSR per visitor.
 */
export const SSR_VISITOR_IP_HEADER = 'x-ssr-visitor-ip'
export const SSR_VISITOR_UA_HEADER = 'x-ssr-visitor-ua'

export type VisitorSource = {
  /** X-Forwarded-For as Caddy sent it: Caddy overwrites a client's own. */
  forwardedFor?: string | null
  /** The socket peer, when no proxy is in front (dev). */
  remoteAddress?: string | null
  userAgent?: string | null
}

const ADDRESS = /^[0-9a-f:.]{2,45}$/i

export function ssrVisitorHeaders(source: VisitorSource): Record<string, string> {
  const forwarded = source.forwardedFor?.split(',')[0]?.trim()
  const ip = forwarded || source.remoteAddress?.trim() || ''
  if (!ADDRESS.test(ip)) return {}
  const headers: Record<string, string> = { [SSR_VISITOR_IP_HEADER]: ip }
  // Header values must stay printable ASCII; the API cuts to 300 anyway.
  const userAgent = source.userAgent?.replace(/[^\x20-\x7e]/g, '').slice(0, 300)
  if (userAgent) headers[SSR_VISITOR_UA_HEADER] = userAgent
  return headers
}

/** Only our own API gets the visitor — never a third-party URL. */
export function isApiRequest(url: string, apiBaseServer: string): boolean {
  const base = apiBaseServer.replace(/\/+$/, '')
  return !!base && (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`))
}
