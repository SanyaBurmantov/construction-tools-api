import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { bearerToken } from '../auth/auth-request';
import type { AuthenticatedRequest } from '../auth/auth-request';

/**
 * Two ways into `/admin/*`:
 *
 * 1. **An ADMIN account** — `Authorization: Bearer <session token>`. This is
 *    what the admin UI uses now that accounts exist, so every action has a
 *    person behind it and access is revoked by disabling the account.
 * 2. **`x-admin-token: $ADMIN_TOKEN`** — the service-to-service path. Kept
 *    deliberately: the runbook/CI curl commands depend on it, and it is the
 *    rescue path when nobody can log in.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const configuredToken = process.env.ADMIN_TOKEN;
    const headerToken = request.header('x-admin-token');
    if (headerToken) {
      if (!configuredToken)
        throw new UnauthorizedException('ADMIN_TOKEN is not configured');
      if (headerToken !== configuredToken)
        throw new UnauthorizedException('Invalid admin token');
      request.adminToken = true;
      return true;
    }

    const token = bearerToken(request);
    if (token) {
      const session = await this.auth.resolveSession(token);
      if (!session) throw new UnauthorizedException('Сессия истекла');
      // 403, not 401: the session is valid, the account simply isn't an admin.
      // The UI keeps the login instead of bouncing to the login screen.
      if (session.user.role !== UserRole.ADMIN)
        throw new ForbiddenException('Недостаточно прав');
      request.authUser = session.user;
      request.authSessionId = session.sessionId;
      return true;
    }

    throw new UnauthorizedException('Требуется авторизация администратора');
  }
}
