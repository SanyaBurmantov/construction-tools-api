import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { bearerToken } from './auth-request';
import type { AuthenticatedRequest } from './auth-request';

/**
 * Attaches the account when the request carries a valid session, and lets
 * anonymous requests through untouched. For endpoints that work for guests but
 * behave slightly differently for a signed-in customer — `POST /orders` stamps
 * the order with `userId` so it shows up in «История заказов», and nothing
 * else changes. A bad or expired token is treated as "no session" rather than
 * an error: the guest path must not break because a stale token is lying
 * around in localStorage.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token) return true;

    const session = await this.auth.resolveSession(token);
    if (session) {
      request.authUser = session.user;
      request.authSessionId = session.sessionId;
    }
    return true;
  }
}
