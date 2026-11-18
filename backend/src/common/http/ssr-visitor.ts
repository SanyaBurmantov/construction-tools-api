import { isIP } from 'node:net';
import { isInternalAddress } from '../guards/internal-aware-throttler.guard';

/** Headers the Nuxt server adds to its SSR fetches (frontend `server/plugins/ssr-visitor.ts`). */
export const SSR_VISITOR_IP_HEADER = 'x-ssr-visitor-ip';
export const SSR_VISITOR_UA_HEADER = 'x-ssr-visitor-ua';

type RequestLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

export type Visitor = { ip?: string; userAgent?: string; viaSsr: boolean };

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Who a request is really for. A server-side render reaches the API from the
 * frontend container, so `req.ip` is 172.18.0.7 and the UA «node» for every
 * visitor and crawler alike — a burst of 503s could not say whose. The
 * frontend names the visitor in two headers, **believed only from inside the
 * Docker network**: from anywhere else they are a client's own claim and are
 * ignored. Logging only — the throttler keeps reading `req.ip` (the SSR
 * exemption depends on it, see InternalAwareThrottlerGuard).
 */
export function requestVisitor(request: RequestLike): Visitor {
  const own: Visitor = {
    ip: request.ip,
    userAgent: single(request.headers?.['user-agent']),
    viaSsr: false,
  };
  if (!isInternalAddress(request.ip)) return own;
  const ip = single(request.headers?.[SSR_VISITOR_IP_HEADER])?.trim();
  if (!ip || !isIP(ip)) return own;
  const userAgent = single(request.headers?.[SSR_VISITOR_UA_HEADER]);
  return { ip, userAgent: userAgent?.slice(0, 300), viaSsr: true };
}
