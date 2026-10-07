import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A specification is only worth filtering by when it covers a decent share of a
 * category and has a manageable set of values. "Мощность: 750/900/1200 Вт" is
 * useful; "Комплектация: <freeform paragraph>" is not.
 */
const AUTO_MIN_PRODUCTS = 5;
const AUTO_MAX_DISTINCT_VALUES = 25;
const AUTO_MAX_VALUE_LENGTH = 40;

@Injectable()
export class SpecificationsAdminService {
  constructor(private prisma: PrismaService) {}

  /** Specifications with usage stats, so the admin can judge what to enable. */
  async list(categoryId?: string) {
    const specifications = await this.prisma.specification.findMany({
      where: categoryId ? { categoryId } : {},
      select: {
        id: true,
        name: true,
        key: true,
        unit: true,
        filterable: true,
        category: { select: { id: true, name: true } },
        _count: { select: { productSpecs: true } },
      },
      orderBy: [{ filterable: 'desc' }, { name: 'asc' }],
      take: 500,
    });
    if (!specifications.length) return { data: [] };

    // Distinct value counts in one pass rather than a query per specification.
    const grouped = await this.prisma.productSpecification.groupBy({
      by: ['specificationId', 'value'],
      where: { specificationId: { in: specifications.map((s) => s.id) } },
      _count: { _all: true },
    });

    const stats = new Map<string, { distinct: number; longest: number }>();
    for (const row of grouped) {
      const current = stats.get(row.specificationId) ?? {
        distinct: 0,
        longest: 0,
      };
      current.distinct += 1;
      current.longest = Math.max(current.longest, row.value.length);
      stats.set(row.specificationId, current);
    }

    return {
      data: specifications.map((spec) => {
        const stat = stats.get(spec.id) ?? { distinct: 0, longest: 0 };
        return {
          ...spec,
          productCount: spec._count.productSpecs,
          distinctValues: stat.distinct,
          longestValue: stat.longest,
          /** Meets the auto-selection heuristic below. */
          recommended:
            spec._count.productSpecs >= AUTO_MIN_PRODUCTS &&
            stat.distinct > 1 &&
            stat.distinct <= AUTO_MAX_DISTINCT_VALUES &&
            stat.longest <= AUTO_MAX_VALUE_LENGTH,
        };
      }),
    };
  }

  async setFilterable(id: string, filterable: boolean) {
    const existing = await this.prisma.specification.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Характеристика не найдена');

    return this.prisma.specification.update({
      where: { id },
      data: { filterable },
    });
  }

  /**
   * Turns on every specification matching the heuristic. Meant as a starting
   * point on a freshly parsed catalogue — the admin then prunes by hand.
   */
  async autoSelect(categoryId?: string) {
    const { data } = await this.list(categoryId);
    const ids = data
      .filter((spec) => spec.recommended && !spec.filterable)
      .map((spec) => spec.id);

    if (!ids.length) return { enabled: 0 };

    await this.prisma.specification.updateMany({
      where: { id: { in: ids } },
      data: { filterable: true },
    });
    return { enabled: ids.length };
  }

  async disableAll(categoryId?: string) {
    const result = await this.prisma.specification.updateMany({
      where: { filterable: true, ...(categoryId ? { categoryId } : {}) },
      data: { filterable: false },
    });
    return { disabled: result.count };
  }
}
