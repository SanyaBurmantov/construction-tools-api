import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClientErrorDto } from './client-error.dto';
import { ErrorLogService } from './error-log.service';

/** statusCode of a browser-side error in ErrorLog: there was no HTTP answer. */
export const BROWSER_ERROR_STATUS = 0;

/**
 * Public: the storefront reports a JavaScript error a visitor hit
 * (`plugins/client-errors.client.ts`). Server errors were always in
 * /admin/errors; a button that throws in someone's Safari was invisible —
 * the visitor just left. Our own collector instead of Sentry: no third party
 * gets our visitors' pages, and the errors sit next to the API's.
 *
 * No IP is kept for these (the browser's user agent says what is needed), and
 * the same error folds into one row like any other (ErrorLogService dedupe).
 */
@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly errors: ErrorLogService) {}

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async report(
    @Body() dto: ClientErrorDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.errors.record({
      statusCode: BROWSER_ERROR_STATUS,
      method: 'BROWSER',
      path: dto.path.split('?')[0],
      kind: dto.name || 'Error',
      message: dto.message,
      stack: dto.stack,
      detail: {
        source: dto.source,
        line: dto.line,
        column: dto.column,
        release: dto.release,
      },
      userAgent,
    });
  }
}
