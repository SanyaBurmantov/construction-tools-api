import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Private, loopback and link-local ranges — where the Nuxt SSR container
 * talks to us from inside the Docker network.
 */
export function isInternalAddress(raw: string | undefined): boolean {
  if (!raw) return false;
  const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    );
  }
  return false;
}

/**
 * The global throttler, minus the server-side render.
 *
 * Every SSR fetch reaches the backend directly from the frontend container
 * (`API_BASE_SERVER`, no Caddy in between), so `req.ip` is that container's
 * address for every visitor and crawler alike. They all shared one 120/min
 * bucket: a crawler walking uncached product pages pushed SSR into 429s, which
 * the storefront rendered as empty pages and 404s.
 *
 * Browser traffic comes through Caddy, which sets X-Forwarded-For from the
 * real peer and ignores whatever the client sent; with `trust proxy` that is
 * what `req.ip` resolves to — a public address, still throttled. Only a peer
 * inside the private network resolves to a private address. Nitro's ISR cache
 * is what bounds the SSR load.
 */
@Injectable()
export class InternalAwareThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (isInternalAddress(request.ip)) return true;
    return super.shouldSkip(context);
  }
}
