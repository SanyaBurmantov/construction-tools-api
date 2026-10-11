import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/auth-request';

/**
 * Is this request being made *as an admin*?
 *
 * Guards run before interceptors and before the exception filter, so an
 * accepted call already carries `authUser`/`adminToken`. A call a guard
 * rejected carries neither — the path prefix is what still catches it, which is
 * deliberate: "someone tried to POST /admin/users and got a 403" is exactly
 * what the audit trail and the error log are for.
 *
 * Shared by `AdminActionLogInterceptor` and `HttpExceptionFilter` so the rule
 * for "admin scope" is written once.
 */
export function isAdminScope(request: AuthenticatedRequest): boolean {
  return (
    request.adminToken === true ||
    request.authUser?.role === UserRole.ADMIN ||
    request.path?.startsWith('/admin') === true
  );
}

/** Who to name in a log line: an account login, the service header, or nobody. */
export function actorLabel(request: AuthenticatedRequest): string {
  if (request.authUser) return request.authUser.login;
  if (request.adminToken) return 'x-admin-token';
  return 'anonymous';
}
