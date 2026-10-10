import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.service';

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
