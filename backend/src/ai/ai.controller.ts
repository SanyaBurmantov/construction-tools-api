import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiEntity } from '@prisma/client';
import { AdminGuard } from '../admin/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth-request';
import { AiService } from './ai.service';
import {
  AiCategoryQueryDto,
  AiCreateTaskDto,
  AiExplainDto,
  AiPreviewDto,
  AiProductQueryDto,
  AiPromptDto,
  AiRescheduleDto,
  AiTemplateTextDto,
  AiTaskItemsQueryDto,
  AiTaskListQueryDto,
  AiUpdatePromptDto,
} from './dto/ai.dto';

@ApiTags('Admin AI')
@UseGuards(AdminGuard)
@Controller('admin/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  @Get('models')
  models() {
    return this.ai.models();
  }

  @Get('products')
  products(@Query() query: AiProductQueryDto) {
    return this.ai.listProducts(query);
  }

  @Get('categories')
  categories(@Query() query: AiCategoryQueryDto) {
    return this.ai.listCategories(query);
  }

  @Get('prompts')
  prompts(@Query('entity') entity?: AiEntity) {
    return this.ai.listPrompts(
      entity && entity in AiEntity ? entity : undefined,
    );
  }

  @Post('prompts')
  createPrompt(@Body() dto: AiPromptDto) {
    return this.ai.createPrompt(dto);
  }

  @Patch('prompts/:id')
  updatePrompt(@Param('id') id: string, @Body() dto: AiUpdatePromptDto) {
    return this.ai.updatePrompt(id, dto);
  }

  @Delete('prompts/:id')
  deletePrompt(@Param('id') id: string) {
    return this.ai.deletePrompt(id);
  }

  /** «Шаблоны и проверки»: the texts the tasks send and the checks they run. */
  @Get('templates')
  templates() {
    return this.ai.templates();
  }

  /** Edits one text (`product-rules`, `category-rules`, `kind:<key>`); empty = default. */
  @Put('templates/:id')
  setTemplate(@Param('id') id: string, @Body() dto: AiTemplateTextDto) {
    return this.ai.setTemplateText(id, dto.text);
  }

  /** Which guide a record gets and the exact messages; no model call. */
  @Post('templates/explain')
  explain(@Body() dto: AiExplainDto) {
    return this.ai.explain(dto);
  }

  @Post('preview')
  preview(@Body() dto: AiPreviewDto) {
    return this.ai.preview(dto);
  }

  @Get('tasks')
  tasks(@Query() query: AiTaskListQueryDto) {
    return this.ai.listTasks(query);
  }

  @Post('tasks')
  createTask(@Body() dto: AiCreateTaskDto, @Req() req: AuthenticatedRequest) {
    const actor =
      req.authUser?.login ?? (req.adminToken ? 'x-admin-token' : null);
    return this.ai.createTask(dto, actor);
  }

  @Get('tasks/:id')
  task(@Param('id') id: string) {
    return this.ai.getTask(id);
  }

  @Get('tasks/:id/items')
  items(@Param('id') id: string, @Query() query: AiTaskItemsQueryDto) {
    return this.ai.getItems(id, query);
  }

  @Post('tasks/:id/pause')
  pause(@Param('id') id: string) {
    return this.ai.pause(id);
  }

  @Post('tasks/:id/resume')
  resume(@Param('id') id: string, @Body() dto: AiRescheduleDto) {
    return this.ai.resume(id, dto.scheduledAt);
  }

  @Post('tasks/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.ai.cancel(id);
  }

  @Post('tasks/:id/retry-failed')
  retryFailed(@Param('id') id: string) {
    return this.ai.retryFailed(id);
  }

  @Post('tasks/:id/revert')
  revert(@Param('id') id: string) {
    return this.ai.revert(id);
  }

  @Post('tasks/:id/items/:itemId/revert')
  revertItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.ai.revert(id, itemId);
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string) {
    return this.ai.deleteTask(id);
  }
}
