import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { readSessionToken } from './auth-request';
import type { AuthenticatedRequest } from './auth-request';
import { assertNotCrossSite, clearStaleSessionCookie } from './session-cookie';

/**
 * Attaches the account when the request carries a valid session, and lets
 * anonymous requests through untouched. For endpoints that work for guests but
 * behave slightly differently for a signed-in customer — `POST /orders` stamps
 * the order with `userId` so it shows up in «История заказов», and nothing
 * else changes. A bad or expired token is treated as "no session" rather than
 * an error: the guest path must not break because a stale session cookie (or
 * Bearer) is lying around.
 *
 * A cookie session on a mutating request is still CSRF-checked: a forged
 * cross-site POST must not be able to act *as the account*, and quietly
 * downgrading it to a guest would hide the problem from our own frontend.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const found = readSessionToken(request);
    if (!found) return true;
    if (found.source === 'cookie') assertNotCrossSite(request);

    const session = await this.auth.resolveSession(found.token);
    if (session) {
      request.authUser = session.user;
      request.authSessionId = session.sessionId;
    } else if (found.source === 'cookie') {
      clearStaleSessionCookie(context);
    }
    return true;
  }
}
