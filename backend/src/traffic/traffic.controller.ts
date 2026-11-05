import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '../admin/admin.guard';
import { MetrikaService } from './metrika.service';
import { PageViewDto } from './traffic.dto';
import { TrafficService } from './traffic.service';

class MetrikaTokenDto {
  @IsString()
  @MaxLength(300)
  token!: string;
}

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
  constructor(
    private readonly traffic: TrafficService,
    private readonly metrika: MetrikaService,
  ) {}

  /** Our own counter. */
  @Get('report')
  report() {
    return this.traffic.report();
  }

  /**
   * The dashboard's tiles: Metrika's numbers when it is connected (they have
   * the history), our own counter otherwise or when Metrika does not answer.
   */
  @Get('summary')
  async summary() {
    const metrika = (await this.metrika.report().catch(() => null)) as {
      summary?: unknown;
    } | null;
    if (metrika?.summary) return { ...metrika.summary, source: 'metrika' };
    return { ...(await this.traffic.summary()), source: 'own' };
  }

  /** The same report read from Yandex Metrika (`?refresh=1` skips the 15-min cache). */
  @Get('metrika')
  metrikaReport(@Query('refresh') refresh?: string) {
    return this.metrika.report(refresh === '1');
  }

  @Get('metrika/status')
  metrikaStatus() {
    return this.metrika.status();
  }

  @Put('metrika/token')
  saveMetrikaToken(@Body() dto: MetrikaTokenDto) {
    return this.metrika.saveToken(dto.token);
  }

  @Delete('metrika/token')
  removeMetrikaToken() {
    return this.metrika.removeToken();
  }
}
