import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    const data: any = { ...createCategoryDto };

    // Calculate depth if parent exists
    if (createCategoryDto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: createCategoryDto.parentId },
      });

      if (!parent) {
        throw new NotFoundException(
          `Parent category with ID ${createCategoryDto.parentId} not found`,
        );
      }

      data.depth = (parent.depth || 0) + 1;
    }

    return this.prisma.category.create({
      data,
      include: {
        parent: true,
        children: true,
        sourceWebsite: true,
        facetFilters: true,
      },
    });
  }

  async findAll(sourceWebsiteId?: string) {
    const where: any = {};
    if (sourceWebsiteId) {
      where.sourceWebsiteId = sourceWebsiteId;
    }

    return this.prisma.category.findMany({
      where,
      include: {
        parent: true,
        children: true,
        sourceWebsite: true,
        facetFilters: true,
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getTree(sourceWebsiteId?: string) {
    const categories = await this.findAll(sourceWebsiteId);
    const rootCategories = categories.filter((c) => !c.parentId);

    const buildTree = (parent: any) => {
      const children = categories.filter((c) => c.parentId === parent.id);
      return {
        ...parent,
        children: children.map((child) => buildTree(child)),
      };
    };

    return rootCategories.map((root) => buildTree(root));
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
        sourceWebsite: true,
        facetFilters: true,
        products: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findFirst({
      where: { slug },
      include: {
        parent: true,
        children: true,
        sourceWebsite: true,
        facetFilters: true,
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with slug ${slug} not found`);
    }

    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    await this.findOne(id); // Check if exists

    return this.prisma.category.update({
      where: { id },
      data: updateCategoryDto,
      include: {
        parent: true,
        children: true,
        sourceWebsite: true,
        facetFilters: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    // Check if category has children
    const children = await this.prisma.category.findMany({
      where: { parentId: id },
    });

    if (children.length > 0) {
      throw new Error(
        `Cannot delete category with ${children.length} child categories`,
      );
    }

    return this.prisma.category.delete({
      where: { id },
    });
  }
}
