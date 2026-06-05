import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  AdminOrderQueryDto,
  AdminUpdateOrderStatusDto,
} from './dto/admin-order-query.dto';

const DEFAULT_CURRENCY = 'BYN';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  private deliveryCost(method: DeliveryMethod): number {
    switch (method) {
      case 'COURIER':
        return Number(process.env.DELIVERY_COST_COURIER ?? 15);
      case 'POST':
        return Number(process.env.DELIVERY_COST_POST ?? 10);
      case 'PICKUP':
      default:
        return 0;
    }
  }

  async createOrder(dto: CreateOrderDto) {
    // Collapse duplicate productIds into summed quantities.
    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(
        item.productId,
        (quantities.get(item.productId) ?? 0) + item.quantity,
      );
    }

    const productIds = [...quantities.keys()];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'PUBLISHED' },
      include: { images: { orderBy: { order: 'asc' }, take: 1 } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    // Validate every requested product is available and priced.
    const orderItems: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    let itemsTotal = 0;
    let currency = DEFAULT_CURRENCY;

    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product) {
        throw new BadRequestException(
          `Товар недоступен для заказа: ${productId}`,
        );
      }
      if (product.priceValue == null || product.priceValue <= 0) {
        throw new BadRequestException(
          `Цена товара недоступна: ${product.name}`,
        );
      }

      const quantity = quantities.get(productId)!;
      const unitPrice = product.priceValue;
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      itemsTotal += lineTotal;
      if (product.priceCurrency) currency = product.priceCurrency;

      orderItems.push({
        product: { connect: { id: product.id } },
        productName: product.name,
        productSlug: product.slug,
        productImage: product.images[0]?.url ?? null,
        unitPrice,
        quantity,
        lineTotal,
      });
    }

    if (
      (dto.deliveryMethod === 'COURIER' || dto.deliveryMethod === 'POST') &&
      !dto.deliveryAddress?.trim()
    ) {
      throw new BadRequestException(
        'Для выбранного способа доставки нужно указать адрес',
      );
    }

    itemsTotal = Math.round(itemsTotal * 100) / 100;
    const deliveryCost = this.deliveryCost(dto.deliveryMethod);
    const total = Math.round((itemsTotal + deliveryCost) * 100) / 100;

    return this.prisma.order.create({
      data: {
        customerName: dto.customerName.trim(),
        customerPhone: dto.customerPhone.trim(),
        customerEmail: dto.customerEmail?.trim() || null,
        comment: dto.comment?.trim() || null,
        deliveryMethod: dto.deliveryMethod,
        deliveryAddress: dto.deliveryAddress?.trim() || null,
        paymentMethod: dto.paymentMethod,
        currency,
        itemsTotal,
        deliveryCost,
        total,
        items: { create: orderItems },
      },
      include: { items: true },
    });
  }

  async getOrders(query: AdminOrderQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const search = query.search.trim();
      const or: Prisma.OrderWhereInput[] = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
      const asNumber = Number(search.replace(/[^0-9]/g, ''));
      if (Number.isInteger(asNumber) && asNumber > 0) {
        or.push({ number: asNumber });
      }
      where.OR = or;
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  async updateStatus(id: string, dto: AdminUpdateOrderStatusDto) {
    await this.getOrder(id);
    return this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
      include: { items: true },
    });
  }
}
