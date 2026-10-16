import { Controller, Get, Param, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private service: CategoriesService) {}

  // Must precede the ':slug' route so '/categories/tree' isn't treated as a slug.
  //
  // `?depth=N` cuts the tree after N levels (1 = roots only) — the storefront
  // header and home grid never look below the roots' children, and the full
  // tree is ~3k nodes embedded into every SSR page. Counts and artwork are
  // still aggregated over the whole subtree. Without the parameter (or with
  // a non-positive / non-numeric one) the full tree is returned, as before.
  @Get('tree')
  getTree(@Query('depth') depth?: string) {
    const levels = Number.parseInt(depth ?? '', 10);
    return this.service.getTree(levels > 0 ? levels : undefined);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }
}
