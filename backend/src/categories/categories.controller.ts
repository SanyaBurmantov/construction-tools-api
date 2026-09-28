import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private service: CategoriesService) {}

  @Get()
  getAll() {
    return this.service.findAll();
  }

  // Must precede the ':slug' route so '/categories/tree' isn't treated as a slug.
  @Get('tree')
  getTree() {
    return this.service.getTree();
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }
}
