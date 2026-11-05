import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { readSessionToken } from '../auth/auth-request';
import type { AuthenticatedRequest } from '../auth/auth-request';
import {
  assertNotCrossSite,
  clearStaleSessionCookie,
} from '../auth/session-cookie';
import { SEO_ACCESS } from './seo-access';

/**
 * Constant-time comparison. Hashing first gives both sides the same length,
 * which timingSafeEqual requires, without leaking the configured length.
 */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Two ways into `/admin/*`:
 *
 * 1. **An ADMIN account** — `Authorization: Bearer <session token>`, or the
 *    HttpOnly session cookie the admin UI rides on (CSRF-checked on mutating
 *    requests, see `session-cookie.ts`). Every action has a person behind it
 *    and access is revoked by disabling the account.
 * 2. **`x-admin-token: $ADMIN_TOKEN`** — the service-to-service path. Kept
 *    deliberately: the runbook/CI curl commands depend on it, and it is the
 *    rescue path when nobody can log in.
 *
 * An **SEO** account passes only on routes marked `@SeoAccess()` (on the
 * route or its controller) — everything else stays ADMIN only.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const configuredToken = process.env.ADMIN_TOKEN;
    const headerToken = request.header('x-admin-token');
    if (headerToken) {
      if (!configuredToken)
        throw new UnauthorizedException('ADMIN_TOKEN is not configured');
      if (!sameSecret(headerToken, configuredToken))
        throw new UnauthorizedException('Invalid admin token');
      request.adminToken = true;
      return true;
    }

    const found = readSessionToken(request);
    if (found) {
      if (found.source === 'cookie') assertNotCrossSite(request);
      const session = await this.auth.resolveSession(found.token);
      if (!session) {
        if (found.source === 'cookie') clearStaleSessionCookie(context);
        throw new UnauthorizedException('Сессия истекла');
      }
      // 403, not 401: the session is valid, the account simply isn't an admin.
      // The UI keeps the login instead of bouncing to the login screen.
      if (!this.allows(session.user.role, context))
        throw new ForbiddenException('Недостаточно прав');
      request.authUser = session.user;
      request.authSessionId = session.sessionId;
      return true;
    }

    throw new UnauthorizedException('Требуется авторизация администратора');
  }

  private allows(role: UserRole, context: ExecutionContext): boolean {
    if (role === UserRole.ADMIN) return true;
    if (role !== UserRole.SEO) return false;
    return (
      this.reflector.getAllAndOverride<boolean>(SEO_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
