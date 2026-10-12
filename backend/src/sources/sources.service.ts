import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What may be told about a supplier outside the admin service: enough to
 * render the "Поставщик" facet, which is itself admin-only now. **Not `url`**
 * — the supplier's own address is internal, same rule as supplier prices and
 * offer links (admin-only via `GET /admin/offers/product/:id`).
 */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  code: true,
} satisfies Prisma.SourceSelect;

/**
 * Read-only on purpose: a `Source` row is created by the parser that owns it
 * (`source.upsert` in every `sites/*-source.parser.ts`), so there is no
 * create/update path here and no endpoint that would need one. The unused
 * `create()` and its DTO were removed rather than left as a tempting
 * second way to mint a supplier.
 */
@Injectable()
export class SourcesService {
  constructor(private prisma: PrismaService) {}

  getAll() {
    return this.prisma.source.findMany({
      select: PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });
  }
}
