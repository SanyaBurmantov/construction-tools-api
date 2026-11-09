import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin/admin.guard';
import { isSeoRequest, SeoAccess } from '../admin/seo-access';
import type { AuthenticatedRequest } from '../auth/auth-request';
import { AiDetectorService } from './ai-detector.service';
import { DetectorCheckDto, DetectorListQueryDto } from './ai-detector.dto';

/** «ИИ-детектор»: admins and the SEO specialist check a text or a page. */
@ApiTags('Admin AI detector')
@UseGuards(AdminGuard)
@SeoAccess()
@Controller('admin/ai-detector')
export class AiDetectorController {
  constructor(private readonly detector: AiDetectorService) {}

  @Get('status')
  status() {
    return this.detector.status();
  }

  @Post('check')
  // One check is up to a few CPU-seconds on the box's spare core.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  check(@Body() dto: DetectorCheckDto, @Req() req: AuthenticatedRequest) {
    return this.detector.check(
      dto,
      req.authUser?.login ?? null,
      isSeoRequest(req),
    );
  }

  @Get('checks')
  list(@Query() query: DetectorListQueryDto) {
    return this.detector.list(query.page, query.limit, query.search);
  }

  @Get('checks/:id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.detector.get(id, isSeoRequest(req));
  }

  @Delete('checks/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.detector.remove(id);
  }
}
