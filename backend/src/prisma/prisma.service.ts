import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { countQuery } from '../perf/query-context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // Queries per request for /admin/performance (perf/query-context.ts).
    // Here rather than in a constructor: specs build this class with their
    // own datasource options.
    this.$use((params, next) => {
      countQuery();
      return next(params);
    });
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
