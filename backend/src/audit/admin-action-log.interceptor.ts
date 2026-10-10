import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AdminActionLogService } from './admin-action-log.service';
import type { AuthenticatedRequest } from '../auth/auth-request';

/** Reads are not logged: the log would be mostly dashboard polling. */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AdminActionLogInterceptor implements NestInterceptor {
  constructor(private readonly log: AdminActionLogService) {}

  /**
   * Guards run before interceptors, so `authUser` / `adminToken` are already
   * set here for an accepted call. A call the guard rejected has neither — the
   * path prefix is what still gets it logged, which is the point: "someone
   * tried to POST /admin/users and got 403" is exactly what an audit is for.
   */
  private static isAdminScope(request: AuthenticatedRequest): boolean {
    return (
      request.adminToken === true ||
      request.authUser?.role === UserRole.ADMIN ||
      request.path.startsWith('/admin')
    );
  }

  private static actorLabel(request: AuthenticatedRequest): string {
    if (request.authUser) return request.authUser.login;
    if (request.adminToken) return 'x-admin-token';
    return 'anonymous';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    if (!MUTATING_METHODS.has(request.method)) return next.handle();

    const startedAt = Date.now();

    const write = (statusCode: number) => {
      // Checked after the handler: the guard may have attached the account in
      // the meantime.
      if (!AdminActionLogInterceptor.isAdminScope(request)) return;
      void this.log.record({
        actorId: request.authUser?.id,
        actorLabel: AdminActionLogInterceptor.actorLabel(request),
        method: request.method,
        path: request.originalUrl || request.path,
        statusCode,
        payload: request.body,
        ip: request.ip,
        durationMs: Date.now() - startedAt,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => write(http.getResponse<Response>().statusCode ?? 200),
        error: (error: unknown) =>
          write(error instanceof HttpException ? error.getStatus() : 500),
      }),
    );
  }
}
