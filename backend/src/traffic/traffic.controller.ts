import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin/admin.guard';
import { PageViewDto } from './traffic.dto';
import { TrafficService } from './traffic.service';

/** Public: the storefront reports each page it showed (fire-and-forget). */
@Controller('traffic')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Post('views')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async view(
    @Body() dto: PageViewDto,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-forwarded-host') forwardedHost?: string,
    @Headers('host') host?: string,
  ) {
    await this.traffic.record(dto, userAgent, forwardedHost || host);
  }
}

@Controller('admin/traffic')
@UseGuards(AdminGuard)
export class TrafficAdminController {
  constructor(private readonly traffic: TrafficService) {}

  @Get('report')
  report() {
    return this.traffic.report();
  }

  /** The dashboard's tile: this month against last month. */
  @Get('summary')
  summary() {
    return this.traffic.summary();
  }
}
