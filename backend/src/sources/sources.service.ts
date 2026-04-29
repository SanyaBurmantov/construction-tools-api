import { Injectable } from '@nestjs/common';
import { CreateSourceProductDto } from './dto/create-source-product.dto';
import { TSourceProduct } from './types/source-product.type';
import { CreateSourceDto } from './dto/create-source.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SourcesProductsService {
  private sourceProducts: TSourceProduct[] = [];

  create(dto: CreateSourceProductDto) {
    const item: TSourceProduct = {
      id: crypto.randomUUID(),

      sourceId: dto.sourceId,

      externalId: dto.externalId,

      url: dto.url,

      name: dto.name,

      price: dto.price,

      currency: dto.currency,

      stock: true,

      images: [],

      specifications: [],

      lastSync: new Date(),
    };

    this.sourceProducts.push(item);

    return item;
  }

  findAll() {
    return this.sourceProducts;
  }
}

@Injectable()
export class SourcesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateSourceDto) {
    return this.prisma.source.create({ data: dto });
  }

  getAll() {
    return this.prisma.source.findMany();
  }
}
