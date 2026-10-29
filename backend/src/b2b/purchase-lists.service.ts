import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withoutPlaceholderImages } from '../common/utils/product-images';
import { MAX_LINE_QUANTITY } from '../cart/cart-limits';
import { PurchaseListDto, UpdatePurchaseListDto } from './dto/b2b.dto';

/** Enough for «по объектам» and «по месяцам»; more is a sign of a bug. */
const MAX_LISTS_PER_USER = 30;

type StoredLine = { productId: string; quantity: number };

/** Duplicate products collapse into one line, quantities capped. Pure. */
export function normalizeLines(items: StoredLine[]): StoredLine[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(
      item.productId,
      Math.min(
        MAX_LINE_QUANTITY,
        (quantities.get(item.productId) ?? 0) + item.quantity,
      ),
    );
  }
  return [...quantities].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

/**
 * A list's lines after product `from` was merged into `to` (ProductMergeService):
 * the line follows the survivor, and where the list already had both, one
 * line stays with the larger quantity — the cart merge's rule, never a sum.
 * Pure.
 */
export function repointLines(
  items: StoredLine[],
  from: string,
  to: string,
): StoredLine[] {
  const out: StoredLine[] = [];
  for (const line of items) {
    const productId = line.productId === from ? to : line.productId;
    const existing = out.find((kept) => kept.productId === productId);
    if (existing)
      existing.quantity = Math.max(existing.quantity, line.quantity);
    else out.push({ productId, quantity: line.quantity });
  }
  return out;
}

export function storedLines(value: Prisma.JsonValue): StoredLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (line): line is StoredLine =>
      typeof line === 'object' &&
      line !== null &&
      typeof (line as StoredLine).productId === 'string' &&
      typeof (line as StoredLine).quantity === 'number',
  );
}

/**
 * Lists of regular purchases. Only product ids and quantities are stored;
 * every read joins the current product, so a list never brings back an old
 * price — «в корзину» then goes through the cart's own re-pricing.
 */
@Injectable()
export class PurchaseListsService {
  constructor(private prisma: PrismaService) {}

  private async hydrate(
    lists: Array<{
      id: string;
      name: string;
      items: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    const ids = [
      ...new Set(
        lists.flatMap((l) => storedLines(l.items).map((i) => i.productId)),
      ),
    ];
    const products = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            slug: true,
            sku: true,
            status: true,
            priceValue: true,
            priceCurrency: true,
            stockStatus: true,
            images: { orderBy: { order: 'asc' }, select: { url: true } },
          },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return lists.map((list) => {
      const items = storedLines(list.items).map((line) => {
        const product = byId.get(line.productId);
        const available =
          product?.status === 'PUBLISHED' && (product.priceValue ?? 0) > 0;
        return {
          productId: line.productId,
          quantity: line.quantity,
          available,
          name: product?.name ?? 'Товар удалён',
          slug: product?.slug ?? null,
          sku: product?.sku ?? null,
          price: available ? (product?.priceValue ?? null) : null,
          currency: product?.priceCurrency ?? 'BYN',
          stockStatus: product?.stockStatus ?? null,
          image: product
            ? (withoutPlaceholderImages(product.images)[0]?.url ?? null)
            : null,
        };
      });
      const total = items.reduce(
        (sum, item) => sum + (item.price ?? 0) * item.quantity,
        0,
      );
      return {
        id: list.id,
        name: list.name,
        createdAt: list.createdAt,
        updatedAt: list.updatedAt,
        items,
        total: Math.round(total * 100) / 100,
      };
    });
  }

  async list(userId: string) {
    const lists = await this.prisma.purchaseList.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return this.hydrate(lists);
  }

  async create(userId: string, dto: PurchaseListDto) {
    const count = await this.prisma.purchaseList.count({ where: { userId } });
    if (count >= MAX_LISTS_PER_USER) {
      throw new BadRequestException(
        `Можно хранить до ${MAX_LISTS_PER_USER} списков — удалите ненужные`,
      );
    }
    const created = await this.prisma.purchaseList.create({
      data: {
        userId,
        name: dto.name.trim(),
        items: normalizeLines(dto.items),
      },
    });
    return (await this.hydrate([created]))[0];
  }

  /** Scoped to the owner: someone else's list is a 404, never a 403. */
  private async own(userId: string, id: string) {
    const list = await this.prisma.purchaseList.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!list) throw new NotFoundException('Список не найден');
  }

  async update(userId: string, id: string, dto: UpdatePurchaseListDto) {
    await this.own(userId, id);
    const updated = await this.prisma.purchaseList.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        items: dto.items ? normalizeLines(dto.items) : undefined,
      },
    });
    return (await this.hydrate([updated]))[0];
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.purchaseList.delete({ where: { id } });
    return { ok: true };
  }
}
