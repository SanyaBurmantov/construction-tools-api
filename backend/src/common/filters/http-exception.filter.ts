import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorLogService } from '../../errors/error-log.service';
import { actorLabel, isAdminScope } from '../admin-scope';
import type { AuthenticatedRequest } from '../../auth/auth-request';

type ErrorResponse = {
  statusCode: number;
  message?: string | string[];
  error?: string;
  [key: string]: unknown;
};

/** Keys the filter renders itself; anything else is passthrough detail. */
const RESERVED_KEYS = new Set([
  'statusCode',
  'message',
  'error',
  'path',
  'timestamp',
]);

/**
 * Client errors that mean "this should have worked" — the ones worth keeping
 * when an admin screen hits them. 401/403/404 are left out: they are the normal
 * noise of a public API and an expired session, and the audit trail already
 * records the rejected admin attempts.
 */
const UNEXPECTED_CLIENT_ERROR = new Set([400, 405, 409, 413, 415, 422]);

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Optional on purpose: the filter is also constructed directly (tests, and
   * any bootstrap that does not want the DB write). Without the service it
   * behaves exactly as it did before — log to stdout, answer the caller.
   */
  constructor(@Optional() private readonly errorLog?: ErrorLogService) {}

  /**
   * What is worth a row in the error log.
   *
   * Every server error, because that is a bug by definition. Client errors only
   * in admin scope: a 400 from the panel is a broken screen (an admin form that
   * cannot save is exactly the case this log was built for), while a 400 from
   * the storefront is usually someone's typo in a form and would drown the log.
   */
  private static shouldRecord(
    status: number,
    request: AuthenticatedRequest,
  ): boolean {
    if (status >= 500) return true;
    return UNEXPECTED_CLIENT_ERROR.has(status) && isAdminScope(request);
  }

  // Honor HttpException, then express-style middleware errors that carry a
  // numeric `status`/`statusCode` (e.g. body-parser's PayloadTooLargeError → 413).
  private static resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (typeof exception === 'object' && exception !== null) {
      const candidate = exception as { status?: unknown; statusCode?: unknown };
      const code = candidate.status ?? candidate.statusCode;
      if (typeof code === 'number' && code >= 400 && code <= 599) return code;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();

    const status = HttpExceptionFilter.resolveStatus(exception);

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const payload =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as ErrorResponse)
        : null;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Client errors may carry machine-readable detail the caller needs to act
    // on — a `code`, a redirect target, the totals behind a 409. Server errors
    // never pass anything through, so internals can't leak in a 500 body.
    const detail: Record<string, unknown> = {};
    if (status < 500 && payload) {
      for (const [key, value] of Object.entries(payload)) {
        if (!RESERVED_KEYS.has(key)) detail[key] = value;
      }
    }

    const message =
      payload?.message ||
      (exception instanceof Error
        ? exception.message
        : 'Internal server error');

    if (this.errorLog && HttpExceptionFilter.shouldRecord(status, request)) {
      // Fire-and-forget with its own catch inside the service: the response
      // below must not wait on a log write, and must not fail with it.
      void this.errorLog.record({
        statusCode: status,
        method: request.method,
        path: request.originalUrl || request.url,
        kind:
          exception instanceof Error
            ? exception.constructor.name
            : typeof exception,
        // A validation failure arrives as a list of sentences; the joined form
        // is what makes the list readable at a glance in the admin table, and
        // the list itself is kept in `detail`.
        message: Array.isArray(message) ? message.join('; ') : String(message),
        detail: Array.isArray(message) ? { message } : undefined,
        stack:
          status >= 500 && exception instanceof Error
            ? exception.stack
            : undefined,
        payload: request.body,
        actorLabel: actorLabel(request),
        ip: request.ip,
        userAgent: request.headers?.['user-agent'],
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: payload?.error || HttpStatus[status],
      ...detail,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
