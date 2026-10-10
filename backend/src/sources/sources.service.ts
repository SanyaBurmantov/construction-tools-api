import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateSourceDto } from './dto/create-source.dto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the storefront may know about a supplier: enough to render the
 * "Поставщик" facet. **Not `url`** — the supplier's own address is internal,
 * same rule as supplier prices and offer links (admin-only via
 * `GET /admin/offers/product/:id`).
 */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  code: true,
} satisfies Prisma.SourceSelect;

@Injectable()
export class SourcesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateSourceDto) {
    return this.prisma.source.create({ data: dto });
  }

  getAll() {
    return this.prisma.source.findMany({
      select: PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });
  }
}
