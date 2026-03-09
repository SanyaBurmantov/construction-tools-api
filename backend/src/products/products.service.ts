import { CreateProductDto } from './dto/create-product-dto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        priceValue: 0,
        priceCurrency: 'BYN',
        stockStatus: 'out_of_stock',
        seoTitle: dto.name,
        seoDescription: dto.name,
      },
    });
  }

  async findAll() {
    return this.prisma.product.findMany({
      include: {
        brand: true,
        category: true,
        productSpecs: true,
        images: true,
        sourceProducts: true,
      },
    });
  }
}
