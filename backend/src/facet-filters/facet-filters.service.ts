import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFacetFilterDto } from './dto/create-facet-filter.dto';
import { UpdateFacetFilterDto } from './dto/update-facet-filter.dto';

@Injectable()
export class FacetFiltersService {
  constructor(private prisma: PrismaService) {}

  async create(createFacetFilterDto: CreateFacetFilterDto) {
    // Verify category exists
    const category = await this.prisma.category.findUnique({
      where: { id: createFacetFilterDto.categoryId },
    });

    if (!category) {
      throw new NotFoundException(
        `Category with ID ${createFacetFilterDto.categoryId} not found`,
      );
    }

    return this.prisma.facetFilter.create({
      data: createFacetFilterDto,
      include: {
        category: true,
      },
    });
  }

  async findAll(categoryId?: string) {
    const where: any = {};
    if (categoryId) {
      where.categoryId = categoryId;
    }

    return this.prisma.facetFilter.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    const facetFilter = await this.prisma.facetFilter.findUnique({
      where: { id },
      include: {
        category: true,
      },
    });

    if (!facetFilter) {
      throw new NotFoundException(`Facet filter with ID ${id} not found`);
    }

    return facetFilter;
  }

  async update(id: string, updateFacetFilterDto: UpdateFacetFilterDto) {
    await this.findOne(id); // Check if exists

    return this.prisma.facetFilter.update({
      where: { id },
      data: updateFacetFilterDto,
      include: {
        category: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.facetFilter.delete({
      where: { id },
    });
  }

  async getFiltersForCategory(categoryId: string) {
    return this.prisma.facetFilter.findMany({
      where: { categoryId, isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async toggleEnabled(id: string) {
    const filter = await this.findOne(id);

    return this.prisma.facetFilter.update({
      where: { id },
      data: { isEnabled: !filter.isEnabled },
      include: {
        category: true,
      },
    });
  }
}
