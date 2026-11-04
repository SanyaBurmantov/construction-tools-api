import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Public: every flag's mode. Nothing secret — the storefront decides with it
 * (`admins` mode shows a feature only to a signed-in admin, client-side).
 */
@Controller('features')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  async list() {
    return { flags: await this.flags.modes() };
  }
}

@Controller('admin/features')
@UseGuards(AdminGuard)
export class FeatureFlagsAdminController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  list() {
    return this.flags.adminList();
  }

  /** `{ mode: 'off' | 'admins' | 'on' }` */
  @Put(':key')
  set(@Param('key') key: string, @Body() body: { mode?: unknown }) {
    return this.flags.setMode(key, body?.mode);
  }
}
