import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

/**
 * The browser session travels in an **HttpOnly cookie**, not in localStorage:
 * script on the page — an XSS included — can neither read it nor send it
 * anywhere but our own `/api`. `Authorization: Bearer` keeps working beside it
 * for non-browser clients (curl, tests); see `readSessionToken`.
 *
 * Attributes, and why:
 * - `Path=/api` — in prod Caddy hands `/api/*` to the backend and everything
 *   else to Nuxt; in dev the browser reaches the backend through Nuxt's
 *   `server/api/[...path].ts` under the same `/api` prefix. Either way every
 *   API call the browser makes is under `/api`, and **no page request is**, so
 *   the cookie never reaches Nuxt's SSR. That is what keeps per-user data out
 *   of the cached, shared storefront HTML by construction, not by care. The
 *   backend itself sees the prefix stripped (`/auth/login`); the attribute is
 *   about the browser's URL, so that does not matter.
 * - no `Domain` — a host-only cookie: `www.` and any other subdomain never
 *   get it.
 * - `SameSite=Lax` — a cross-site form POST carries no cookie; the
 *   Origin/X-Requested-With check below covers what Lax does not (same-site
 *   subdomains, old browsers).
 * - `Secure` — on in production; `AUTH_COOKIE_SECURE=true|false` overrides.
 *   Off by default in dev, because Safari refuses a Secure cookie over
 *   http://localhost even though Chrome and Firefox accept it.
 * - `Expires` = the `UserSession.expiresAt` it belongs to.
 */
export const SESSION_COOKIE = 'sid';

/**
 * Login/register return the token in the body (and set no cookie) only when
 * asked with this header — for scripts that want `Authorization: Bearer`.
 * The browser never sends it, so the token never reaches page script. Opting
 * in needs the password anyway, so it opens nothing a script could not do.
 */
export const BEARER_TRANSPORT_HEADER = 'x-auth-transport';

export function sessionCookiePath(): string {
  return process.env.AUTH_COOKIE_PATH?.trim() || '/api';
}

function cookieSecure(): boolean {
  const flag = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: sessionCookiePath(),
  };
}

export function setSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
) {
  response.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE, baseOptions());
}

/** True when the client asked for the token in the body (non-browser use). */
export function wantsBearerTransport(request: Request): boolean {
  return request.header(BEARER_TRANSPORT_HEADER)?.toLowerCase() === 'bearer';
}

/**
 * A minimal `Cookie` header parser — enough for one opaque token. Not
 * `cookie-parser`: one value does not justify a dependency.
 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      value = value.slice(1, -1);
    if (!name || cookies.has(name)) continue; // first one wins, like browsers
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export function sessionCookieToken(request: Request): string | null {
  return parseCookies(request.header('cookie')).get(SESSION_COOKIE) || null;
}

export type SessionSource = 'bearer' | 'cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function allowedOrigins(): Set<string> {
  const list = [
    process.env.PUBLIC_ORIGIN,
    ...(process.env.CORS_ORIGIN?.split(',') ?? []),
  ];
  const origins = new Set<string>();
  for (const entry of list) {
    const origin = originOf(entry?.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * Whether the request's Origin (or, failing that, Referer) is our own site:
 * one of PUBLIC_ORIGIN / CORS_ORIGIN, or the host the request was addressed
 * to (`X-Forwarded-Host` first — Caddy sets it; an attacker cannot make a
 * victim's browser forge it). `null` when the request names no origin at all.
 */
export function isSameOriginRequest(request: Request): boolean | null {
  // A sandboxed frame or a cross-origin redirect chain sends `Origin: null`:
  // that is a named origin, and not ours.
  if (request.header('origin')?.trim() === 'null') return false;
  const origin =
    originOf(request.header('origin')) ?? originOf(request.header('referer'));
  if (!origin) return null;
  if (allowedOrigins().has(origin)) return true;
  const host = (
    request.header('x-forwarded-host')?.split(',')[0] ?? request.header('host')
  )
    ?.trim()
    .toLowerCase();
  return Boolean(host) && new URL(origin).host === host;
}

/**
 * CSRF check for **cookie-authenticated** mutating requests. A cookie is sent
 * by the browser on its own, so a state change needs proof the request came
 * from our page: an `X-Requested-With` header (a cross-site form cannot set
 * one, and a cross-site fetch with it needs a CORS preflight we do not grant)
 * or an Origin/Referer that is ours. Bearer and `x-admin-token` callers are
 * not checked — a browser never attaches those by itself.
 *
 * `strict: false` is for login/register: no cookie is being *used* there, so a
 * request naming no origin (curl) is fine; only a foreign origin — a login
 * CSRF planting someone else's account in the victim's browser — is refused.
 */
export function assertNotCrossSite(request: Request, strict = true) {
  const method = (request.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return;
  if (request.header('x-requested-with')) return;
  const sameOrigin = isSameOriginRequest(request);
  if (sameOrigin === true) return;
  if (sameOrigin === null && !strict) return;
  throw new ForbiddenException('Запрос с чужого сайта отклонён');
}

/**
 * Drops a cookie whose session the server no longer knows (expired, logged
 * out elsewhere, account disabled), so the browser stops sending a dead token
 * on every request. Tolerates contexts without a response (unit tests).
 */
export function clearStaleSessionCookie(context: ExecutionContext) {
  const response = context.switchToHttp().getResponse?.<Response>();
  if (response && typeof response.clearCookie === 'function')
    clearSessionCookie(response);
}
