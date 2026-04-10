import { Injectable } from '@nestjs/common';
import { TBrand } from './types/brand.type';
import { CreateBrandDto } from './dto/create-brand.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.brand.findMany()
  }
}
