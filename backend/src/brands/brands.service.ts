import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.brand.findMany({
      include: {
        _count: {
          select: { products: { where: { status: 'PUBLISHED' } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Brand landing page payload: categories the brand has published products in. */
  async getCategories(slug: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { OR: [{ slug }, { id: slug }] },
      select: { id: true, name: true, slug: true },
    });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    const counts = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { brandId: brand.id, status: 'PUBLISHED' },
      _count: { _all: true },
    });

    const categories = counts.length
      ? await this.prisma.category.findMany({
          where: { id: { in: counts.map((item) => item.categoryId) } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const countByCategory = new Map(
      counts.map((item) => [item.categoryId, item._count._all]),
    );

    return {
      brand,
      categories: categories
        .map((category) => ({
          ...category,
          count: countByCategory.get(category.id) ?? 0,
        }))
        .sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'),
        ),
    };
  }
}
