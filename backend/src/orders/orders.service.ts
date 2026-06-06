import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto) {
    const productIds = Array.from(new Set(dto.items.map(item => item.productId)))
    const existingProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true }
    })
    const existingProductIds = new Set(existingProducts.map(product => product.id))

    const totalAmount = dto.totalAmount ?? dto.items.reduce((sum, item) => {
      return sum + (item.priceValue ?? 0) * item.quantity
    }, 0)

    return this.prisma.order.create({
      data: {
        customerName: dto.customerName,
        phone: dto.phone,
        email: dto.email,
        comment: dto.comment,
        totalQuantity: dto.totalQuantity,
        totalAmount,
        items: {
          create: dto.items.map(item => ({
            productId: existingProductIds.has(item.productId) ? item.productId : null,
            productName: item.productName,
            productSlug: item.productSlug,
            priceValue: item.priceValue,
            priceCurrency: item.priceCurrency,
            quantity: item.quantity,
          }))
        }
      },
      include: {
        items: true
      }
    })
  }
}
