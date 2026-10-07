import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

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

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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
    const request = ctx.getRequest<Request>();

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

    response.status(status).json({
      statusCode: status,
      message:
        payload?.message ||
        (exception instanceof Error
          ? exception.message
          : 'Internal server error'),
      error: payload?.error || HttpStatus[status],
      ...detail,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
