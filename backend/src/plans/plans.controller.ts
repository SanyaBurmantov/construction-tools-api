import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import type { AuthenticatedRequest } from '../auth/auth-request';
import { PlanItemDto } from './plans.dto';
import { PlansService } from './plans.service';

@Controller('admin/plans')
@UseGuards(AdminGuard)
export class PlansAdminController {
  constructor(private readonly plans: PlansService) {}

  /** Every goal and task, goals with their live measure. */
  @Get()
  list() {
    return this.plans.list();
  }

  @Post()
  create(@Body() dto: PlanItemDto, @Req() req: AuthenticatedRequest) {
    const user = req.authUser;
    const name = user ? user.login : 'x-admin-token';
    return this.plans.create(dto, name);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanItemDto) {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.remove(id);
  }
}
