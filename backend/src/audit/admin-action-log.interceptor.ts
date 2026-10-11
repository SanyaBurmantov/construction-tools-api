import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Response } from 'express';
import { AdminActionLogService } from './admin-action-log.service';
import { actorLabel, isAdminScope } from '../common/admin-scope';
import type { AuthenticatedRequest } from '../auth/auth-request';

/** Reads are not logged: the log would be mostly dashboard polling. */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AdminActionLogInterceptor implements NestInterceptor {
  constructor(private readonly log: AdminActionLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    if (!MUTATING_METHODS.has(request.method)) return next.handle();

    const startedAt = Date.now();

    const write = (statusCode: number) => {
      // Checked after the handler: the guard may have attached the account in
      // the meantime.
      if (!isAdminScope(request)) return;
      void this.log.record({
        actorId: request.authUser?.id,
        actorLabel: actorLabel(request),
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
