import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin/admin.guard';
import { SearchEventDto } from './search-log.dto';
import { SearchLogService } from './search-log.service';

/** Public: the storefront reports a search or a click (fire-and-forget). */
@Controller('search')
export class SearchLogController {
  constructor(private readonly searchLog: SearchLogService) {}

  @Post('events')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async event(@Body() dto: SearchEventDto, @Ip() ip: string) {
    await this.searchLog.record(dto, ip);
  }
}

@Controller('admin/search')
@UseGuards(AdminGuard)
export class SearchLogAdminController {
  constructor(private readonly searchLog: SearchLogService) {}

  @Get('report')
  report(@Query('days') days?: string) {
    const n = Number(days);
    return this.searchLog.report(
      Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : 30,
    );
  }
}
