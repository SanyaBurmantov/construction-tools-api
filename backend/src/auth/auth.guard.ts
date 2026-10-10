import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { bearerToken } from './auth-request';
import type { AuthenticatedRequest } from './auth-request';

/** Requires any logged-in account. Attaches it to the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException('Требуется авторизация');

    const session = await this.auth.resolveSession(token);
    if (!session) throw new UnauthorizedException('Сессия истекла');

    request.authUser = session.user;
    request.authSessionId = session.sessionId;
    return true;
  }
}
