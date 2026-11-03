import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { StorefrontService } from './storefront.service';

/** Public: what the header strip and the home page's popular row show. */
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  /** Empty `data` = not curated; the storefront draws its automatic strip. */
  @Get('header-categories')
  async headerCategories() {
    return { data: await this.storefront.headerCategories() };
  }

  /** Empty `data` = not curated; the home page falls back to the best rated. */
  @Get('popular-products')
  async popularProducts() {
    return { data: await this.storefront.popularProducts() };
  }
}

@Controller('admin/storefront')
@UseGuards(AdminGuard)
export class StorefrontAdminController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get()
  view() {
    return this.storefront.adminView();
  }

  /** `{ headerCategories?: [{categoryId, label?, highlight?}], popularProducts?: [id] }` */
  @Put()
  update(
    @Body() body: { headerCategories?: unknown; popularProducts?: unknown },
  ) {
    return this.storefront.update(body ?? {});
  }
}
