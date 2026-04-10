import { CreateCategoryDto } from './dto/create-category.dto';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateCategoryDto) {
    return []
  }

  findAll() {
    return this.prisma.category.findMany()
  }
}
