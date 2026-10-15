import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { readSessionToken } from './auth-request';
import type { AuthenticatedRequest } from './auth-request';
import { assertNotCrossSite, clearStaleSessionCookie } from './session-cookie';

/**
 * Requires any logged-in account — `Authorization: Bearer` first, then the
 * HttpOnly session cookie (CSRF-checked on mutating requests). Attaches the
 * account to the request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const found = readSessionToken(request);
    if (!found) throw new UnauthorizedException('Требуется авторизация');
    if (found.source === 'cookie') assertNotCrossSite(request);

    const session = await this.auth.resolveSession(found.token);
    if (!session) {
      if (found.source === 'cookie') clearStaleSessionCookie(context);
      throw new UnauthorizedException('Сессия истекла');
    }

    request.authUser = session.user;
    request.authSessionId = session.sessionId;
    return true;
  }
}
