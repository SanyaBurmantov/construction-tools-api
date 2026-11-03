import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { PerfService } from './perf.service';

/** «Скорость» (`/admin/performance`). */
@Controller('admin/perf')
@UseGuards(AdminGuard)
export class PerfController {
  constructor(private readonly perf: PerfService) {}

  /** API timings per route since the API process started. */
  @Get('requests')
  requests() {
    return this.perf.requests();
  }

  @Post('requests/reset')
  resetRequests() {
    return this.perf.resetRequests();
  }

  @Get('db')
  database(@Query('sort') sort?: string) {
    return this.perf.database(
      sort === 'mean' || sort === 'calls' ? sort : 'total',
    );
  }

  @Post('db/reset')
  resetDatabase() {
    return this.perf.resetDatabase();
  }
}
