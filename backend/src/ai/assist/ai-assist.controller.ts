import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiSuggestionKind, AiSuggestionStatus } from '@prisma/client';
import { AdminGuard } from '../../admin/admin.guard';
import type { AuthenticatedRequest } from '../../auth/auth-request';
import { ASSIST_JOBS, AssistJob } from './assist-jobs';
import { AiAssistService } from './ai-assist.service';

function job(value: string): AssistJob {
  if (!(ASSIST_JOBS as readonly string[]).includes(value)) {
    throw new NotFoundException('Нет такой работы');
  }
  return value as AssistJob;
}

const who = (req: AuthenticatedRequest) =>
  req.authUser?.login ?? (req.adminToken ? 'x-admin-token' : null);

@ApiTags('Admin AI assistant')
@UseGuards(AdminGuard)
@Controller('admin/ai/assist')
export class AiAssistController {
  constructor(private readonly assist: AiAssistService) {}

  @Get()
  overview() {
    return this.assist.overview();
  }

  @Put('jobs/:job')
  update(
    @Param('job') key: string,
    @Body()
    body: {
      enabled?: unknown;
      daily?: unknown;
      template?: unknown;
      fields?: unknown;
    },
  ) {
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (body.daily !== undefined) {
      const daily = Number(body.daily);
      if (!Number.isFinite(daily) || daily < 0 || daily > 5000) {
        throw new BadRequestException('Лимит — от 0 до 5000');
      }
      patch.daily = daily;
    }
    if (typeof body.template === 'string') patch.template = body.template;
    if (Array.isArray(body.fields)) patch.fields = body.fields;
    return this.assist.updateSettings(job(key), patch);
  }

  /** One step now, in this process — even when the job is switched off. */
  @Post('jobs/:job/run')
  run(@Param('job') key: string) {
    return this.assist.step(job(key), { force: true });
  }

  @Get('suggestions')
  suggestions(
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('auto') auto?: string,
    @Query('page') page?: string,
  ) {
    if (kind && !(kind in AiSuggestionKind))
      throw new BadRequestException('kind');
    if (status && !(status in AiSuggestionStatus))
      throw new BadRequestException('status');
    return this.assist.listSuggestions({
      kind: kind as AiSuggestionKind | undefined,
      status: status as AiSuggestionStatus | undefined,
      auto: auto === 'true' ? true : auto === 'false' ? false : undefined,
      page: Math.max(1, Number(page) || 1),
    });
  }

  @Post('suggestions/:id/apply')
  apply(
    @Param('id') id: string,
    @Body() body: { categoryId?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.assist.apply(id, who(req), {
      categoryId:
        typeof body?.categoryId === 'string' ? body.categoryId : undefined,
    });
  }

  @Post('suggestions/:id/reject')
  reject(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.assist.reject(id, who(req));
  }

  @Post('suggestions/:id/revert')
  revert(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.assist.revert(id, who(req));
  }

  /** «Отклонённое → Категории». */
  @Get('unplaced')
  unplaced(@Query('page') page?: string) {
    return this.assist.listUnplaced(Math.max(1, Number(page) || 1));
  }

  @Delete('suggestions/:id')
  retry(@Param('id') id: string) {
    return this.assist.retry(id);
  }

  @Get('duplicates')
  duplicates() {
    return this.assist.duplicateVerdicts();
  }

  @Get('landings')
  landings(
    @Query('page') page?: string,
    @Query('published') published?: string,
  ) {
    return this.assist.listLandings(
      Math.max(1, Number(page) || 1),
      published === 'true' ? true : published === 'false' ? false : undefined,
    );
  }

  @Patch('landings/:id')
  setLanding(@Param('id') id: string, @Body() body: { isPublished?: unknown }) {
    if (typeof body?.isPublished !== 'boolean') {
      throw new BadRequestException('isPublished');
    }
    return this.assist.setLandingPublished(id, body.isPublished);
  }

  @Delete('landings/:id')
  deleteLanding(@Param('id') id: string) {
    return this.assist.deleteLanding(id);
  }
}

/** The storefront's side of the landings: public, cached by the page. */
@ApiTags('Storefront')
@Controller('storefront')
export class LandingsController {
  constructor(private readonly assist: AiAssistService) {}

  /** `brand` is a slug (the pretty URL) or an id (the old `?brands=` link). */
  @Get('landing')
  async landing(
    @Query('category') category?: string,
    @Query('brand') brand?: string,
  ) {
    if (!category || !brand) throw new NotFoundException();
    const byId = /^[0-9a-f-]{36}$/i.test(brand);
    const landing = await this.assist.publicLanding(
      category,
      byId ? { id: brand } : { slug: brand },
    );
    if (!landing) throw new NotFoundException();
    return landing;
  }

  @Get('landings')
  landings() {
    return this.assist.publicLandings();
  }
}
