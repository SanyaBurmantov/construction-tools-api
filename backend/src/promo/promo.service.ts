import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PromoCode, PromoCodeType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminCreatePromoCodeDto,
  AdminUpdatePromoCodeDto,
} from './dto/promo-code.dto';

export type PromoEvaluation = {
  code: PromoCode;
  discount: number;
  freeDelivery: boolean;
};

const round = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class PromoService {
  constructor(private prisma: PrismaService) {}

  private normalize(code: string) {
    return code.trim().toUpperCase();
  }

  /**
   * Resolves a code and computes its discount against an items subtotal.
   * Throws with a user-facing reason when the code can't be applied — the
   * checkout preview and POST /orders both go through here, so a code that
   * previews as valid can still be rejected at order time if it ran out.
   */
  async evaluate(
    rawCode: string,
    itemsTotal: number,
  ): Promise<PromoEvaluation> {
    const code = await this.prisma.promoCode.findUnique({
      where: { code: this.normalize(rawCode) },
    });

    if (!code || !code.isActive) {
      throw new BadRequestException('Промокод не найден или неактивен');
    }

    const now = new Date();
    if (code.startsAt && code.startsAt > now) {
      throw new BadRequestException('Промокод ещё не действует');
    }
    if (code.endsAt && code.endsAt < now) {
      throw new BadRequestException('Срок действия промокода истёк');
    }
    if (code.maxUses != null && code.usedCount >= code.maxUses) {
      throw new BadRequestException('Промокод исчерпан');
    }
    if (code.minOrderTotal != null && itemsTotal < code.minOrderTotal) {
      throw new BadRequestException(
        `Промокод действует от ${code.minOrderTotal}`,
      );
    }

    const raw =
      code.type === PromoCodeType.PERCENT
        ? (itemsTotal * code.value) / 100
        : code.value;

    // Never discount below zero — a fixed code larger than the cart caps out.
    const discount = round(Math.min(Math.max(raw, 0), itemsTotal));

    return { code, discount, freeDelivery: code.freeDelivery };
  }

  /** Checkout preview: same rules, but shaped for the UI instead of throwing shape. */
  async validateForCheckout(rawCode: string, itemsTotal: number) {
    const { code, discount, freeDelivery } = await this.evaluate(
      rawCode,
      itemsTotal,
    );
    return {
      valid: true,
      code: code.code,
      description: code.description,
      type: code.type,
      value: code.value,
      discount,
      freeDelivery,
    };
  }

  /**
   * The codes a signed-in customer may use right now — the "Доступные
   * промокоды" section of the account. Mirrors `evaluate()`'s rules, minus the
   * cart-dependent minimum (which is shown as a condition instead), and skips
   * codes an admin marked non-public.
   *
   * The exhausted check is done in JS on purpose: Prisma cannot compare two
   * columns (`usedCount >= maxUses`) in a `where`, and these lists are tiny.
   */
  async listAvailable() {
    const now = new Date();
    const codes = await this.prisma.promoCode.findMany({
      where: {
        isActive: true,
        isPublic: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ endsAt: 'asc' }, { createdAt: 'desc' }],
    });

    const data = codes
      .filter((code) => code.maxUses == null || code.usedCount < code.maxUses)
      .map((code) => ({
        id: code.id,
        code: code.code,
        description: code.description,
        type: code.type,
        value: code.value,
        minOrderTotal: code.minOrderTotal,
        freeDelivery: code.freeDelivery,
        endsAt: code.endsAt,
        // How many applications are left, null when unlimited. `usedCount`
        // itself is admin information and stays out of the response.
        usesLeft:
          code.maxUses == null
            ? null
            : Math.max(0, code.maxUses - code.usedCount),
      }));

    return { data };
  }

  async adminList() {
    const codes = await this.prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    });
    return { data: codes };
  }

  private buildData(
    dto: AdminCreatePromoCodeDto | AdminUpdatePromoCodeDto,
  ): Prisma.PromoCodeUncheckedCreateInput {
    if (
      dto.type === PromoCodeType.PERCENT &&
      dto.value != null &&
      dto.value > 100
    ) {
      throw new BadRequestException('Процент скидки не может превышать 100');
    }

    return {
      code: this.normalize(dto.code),
      description: dto.description?.trim() || null,
      type: dto.type ?? PromoCodeType.PERCENT,
      value: dto.value,
      minOrderTotal: dto.minOrderTotal ?? null,
      maxUses: dto.maxUses ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      isActive: dto.isActive ?? true,
      freeDelivery: dto.freeDelivery ?? false,
      isPublic: dto.isPublic ?? true,
    };
  }

  async create(dto: AdminCreatePromoCodeDto) {
    const data = this.buildData(dto);
    const existing = await this.prisma.promoCode.findUnique({
      where: { code: data.code },
    });
    if (existing)
      throw new BadRequestException('Такой промокод уже существует');
    return this.prisma.promoCode.create({ data });
  }

  async update(id: string, dto: AdminUpdatePromoCodeDto) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Промокод не найден');

    const data = this.buildData({
      ...existing,
      ...dto,
    } as AdminCreatePromoCodeDto);
    return this.prisma.promoCode.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Промокод не найден');
    // Orders keep promoCodeLabel, so deleting a code doesn't lose order history.
    await this.prisma.order.updateMany({
      where: { promoCodeId: id },
      data: { promoCodeId: null },
    });
    await this.prisma.promoCode.delete({ where: { id } });
    return { ok: true };
  }
}
