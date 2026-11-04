import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PerfService } from './perf.service';
import { queryContext } from './query-context';

/**
 * Times every request from arrival to the last byte sent (`finish`), the
 * exception filter and serialisation included — what the visitor waits for
 * minus the network. The route template is known by then (`req.route`).
 */
@Injectable()
export class RequestTimingMiddleware implements NestMiddleware {
  constructor(private readonly perf: PerfService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    // Everything the handler awaits runs inside this store, so Prisma can
    // count its operations per request (query-context.ts).
    const store = { queries: 0 };
    res.once('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      this.perf.record(req, res.statusCode, ms, store.queries);
    });
    queryContext.run(store, next);
  }
}
