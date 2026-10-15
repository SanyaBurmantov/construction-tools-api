import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.service';
import { sessionCookieToken } from './session-cookie';
import type { SessionSource } from './session-cookie';

/**
 * What the guards attach to the request. `adminToken` marks the
 * service-to-service path (the `x-admin-token` header used by the runbook
 * curl commands), where there is no account behind the call.
 */
export type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
  adminToken?: boolean;
};

/** Reads `Authorization: Bearer <token>`; null when absent or malformed. */
export function bearerToken(request: Request): string | null {
  const header = request.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}

/**
 * The session token behind a request and where it came from. Bearer wins:
 * an explicit header is what a script or test means, and it is never sent by
 * the browser on its own, so it needs no CSRF check. The HttpOnly cookie is
 * the browser's path — see `session-cookie.ts`.
 */
export function readSessionToken(
  request: Request,
): { token: string; source: SessionSource } | null {
  const bearer = bearerToken(request);
  if (bearer) return { token: bearer, source: 'bearer' };
  const cookie = sessionCookieToken(request);
  if (cookie) return { token: cookie, source: 'cookie' };
  return null;
}
