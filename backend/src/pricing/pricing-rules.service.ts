import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PricingScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';
import {
  AdminCreatePricingRuleDto,
  AdminUpdatePricingRuleDto,
} from './dto/pricing.dto';

@Injectable()
export class PricingRulesService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
  ) {}

  list() {
    return this.prisma.pricingRule.findMany({
      orderBy: [{ scope: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * A scoped rule without its target would silently match nothing, so the
   * mismatch is rejected up front rather than becoming a dead rule.
   */
  private validate(dto: AdminCreatePricingRuleDto | AdminUpdatePricingRuleDto) {
    const scope = dto.scope ?? PricingScope.GLOBAL;

    if (scope === 'CATEGORY' && !dto.categoryId) {
      throw new BadRequestException(
        'Для правила по категории выберите категорию',
      );
    }
    if (scope === 'BRAND' && !dto.brandId) {
      throw new BadRequestException('Для правила по бренду выберите бренд');
    }
    if (scope === 'SOURCE' && !dto.sourceId) {
      throw new BadRequestException(
        'Для правила по поставщику выберите поставщика',
      );
    }
    if (
      dto.minCost != null &&
      dto.maxCost != null &&
      dto.minCost > dto.maxCost
    ) {
      throw new BadRequestException(
        'Нижняя граница закупки не может быть больше верхней',
      );
    }
    if (
      (dto.markupPercent ?? 0) === 0 &&
      (dto.markupFixed ?? 0) === 0 &&
      dto.minMargin == null
    ) {
      throw new BadRequestException(
        'Правило без наценки ничего не изменит — задайте процент, надбавку или минимальную маржу',
      );
    }

    return scope;
  }

  private buildData(
    dto: AdminCreatePricingRuleDto,
    scope: PricingScope,
  ): Prisma.PricingRuleUncheckedCreateInput {
    return {
      name: dto.name.trim(),
      scope,
      // Only the target matching the scope is stored; the others are cleared so
      // a rule switched from BRAND to GLOBAL doesn't keep a stale brandId.
      categoryId: scope === 'CATEGORY' ? (dto.categoryId ?? null) : null,
      brandId: scope === 'BRAND' ? (dto.brandId ?? null) : null,
      sourceId: scope === 'SOURCE' ? (dto.sourceId ?? null) : null,
      minCost: dto.minCost ?? null,
      maxCost: dto.maxCost ?? null,
      markupPercent: dto.markupPercent ?? 0,
      markupFixed: dto.markupFixed ?? 0,
      minMargin: dto.minMargin ?? null,
      rounding: dto.rounding ?? 'CHARM_90',
      priority: dto.priority ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  async create(dto: AdminCreatePricingRuleDto) {
    const scope = this.validate(dto);
    const rule = await this.prisma.pricingRule.create({
      data: this.buildData(dto, scope),
    });
    this.pricing.invalidateRulesCache();
    return rule;
  }

  async update(id: string, dto: AdminUpdatePricingRuleDto) {
    const existing = await this.prisma.pricingRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Правило не найдено');

    const merged = { ...existing, ...dto } as AdminCreatePricingRuleDto;
    const scope = this.validate(merged);

    const rule = await this.prisma.pricingRule.update({
      where: { id },
      data: this.buildData(merged, scope),
    });
    this.pricing.invalidateRulesCache();
    return rule;
  }

  async remove(id: string) {
    const existing = await this.prisma.pricingRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Правило не найдено');

    // Products keep working — they just lose the "priced by" reference.
    await this.prisma.product.updateMany({
      where: { appliedRuleId: id },
      data: { appliedRuleId: null },
    });
    await this.prisma.pricingRule.delete({ where: { id } });
    this.pricing.invalidateRulesCache();
    return { ok: true };
  }
}
