import { CreateCategoryDto } from './dto/create-category.dto';
import { Injectable } from '@nestjs/common';
import { TCategory } from './types/category.type';
import * as crypto from 'node:crypto';

@Injectable()
export class CategoriesService {
  private categories: TCategory[] = [];

  create(dto: CreateCategoryDto) {
    const parent = dto.parentId
      ? this.categories.find((c) => c.id === dto.parentId)
      : undefined;

    const category: TCategory = {
      path: [],
      id: crypto.randomUUID(),

      name: dto.name,

      slug: dto.slug,

      parentId: dto.parentId,

      description: dto.description,

      level: parent ? parent.level + 1 : 0,

      children: [],

      seo: {
        title: dto.name,
        description: dto.name,
      },
    };

    this.categories.push(category);

    return category;
  }

  findAll() {
    return this.categories;
  }
}
