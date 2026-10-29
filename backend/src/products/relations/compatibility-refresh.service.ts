import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runsBackgroundJobs } from '../../common/utils/process-role';
import { normalizeBrand } from '../../offers/product-matching';
import {
  COMPATIBILITY_RULE_VERSION,
  compatibilitySignature,
  extractModelReferences,
  matchesReference,
  type RelationBrand,
  type RelationIdentity,
} from './compatibility';
import { RELATION_IDENTITY_SELECT } from './relation-select';

const CURSOR_KEY = 'productRelations.cursor.v1';
const BATCH_SIZE = 40;
const MAX_CANDIDATES = 64;

/** Bounded rolling sweep: no catalogue-sized heap, no work in HTTP requests. */
@Injectable()
export class CompatibilityRefreshService {
  private readonly logger = new Logger(CompatibilityRefreshService.name);
  private running = false;
  private brands?: { expires: number; rows: RelationBrand[] };

  constructor(private readonly prisma: PrismaService) {}

  @Interval(30_000)
  async refresh(): Promise<number> {
    if (!runsBackgroundJobs() || this.running) return 0;
    this.running = true;
    try {
      const cursor = await this.prisma.siteSetting.findUnique({
        where: { key: CURSOR_KEY },
      });
      const rows = await this.prisma.product.findMany({
        where: {
          status: 'PUBLISHED',
          ...(cursor?.value ? { id: { gt: cursor.value } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: RELATION_IDENTITY_SELECT,
      });
      if (!this.brands || this.brands.expires < Date.now()) {
        this.brands = {
          rows: await this.prisma.brand.findMany({
            select: { id: true, name: true },
          }),
          expires: Date.now() + 3_600_000,
        };
      }
      let links = 0;
      for (const row of rows)
        links += await this.refreshProduct(row, this.brands.rows);
      await this.prisma.siteSetting.upsert({
        where: { key: CURSOR_KEY },
        create: { key: CURSOR_KEY, value: rows.at(-1)?.id ?? '' },
        update: { value: rows.at(-1)?.id ?? '' },
      });
      // Hidden/archived products never appear in reads; periodically reclaim
      // their derived rows too. Product deletion is handled by foreign keys.
      if (!rows.length) {
        await this.prisma.productCompatibility.deleteMany({
          where: {
            OR: [
              { accessory: { status: { not: 'PUBLISHED' } } },
              { product: { status: { not: 'PUBLISHED' } } },
            ],
          },
        });
      }
      return links;
    } catch (error) {
      this.logger.error(
        `Compatibility refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  async refreshProduct(
    product: RelationIdentity,
    brands: RelationBrand[],
  ): Promise<number> {
    const references = extractModelReferences(product, brands);
    let candidates: RelationIdentity[] = [];
    if (references.length) {
      const brandNames = new Map(brands.map((brand) => [brand.id, brand.name]));
      candidates = await this.prisma.product.findMany({
        where: {
          id: { not: product.id },
          status: 'PUBLISHED',
          OR: references.map((ref) => {
            const key = `${normalizeBrand(brandNames.get(ref.brandId))}:${ref.code}`;
            return {
              brandId: ref.brandId,
              OR: [
                { matchModel: key },
                { matchSku: key },
                { model: { equals: ref.code, mode: 'insensitive' as const } },
                { sku: { equals: ref.code, mode: 'insensitive' as const } },
              ],
            };
          }),
        },
        // A truncated candidate set must not turn ambiguity into certainty.
        take: MAX_CANDIDATES + 1,
        select: RELATION_IDENTITY_SELECT,
      });
    }
    const data: Prisma.ProductCompatibilityCreateManyInput[] = [];
    if (candidates.length <= MAX_CANDIDATES) {
      for (const reference of references) {
        const matches = candidates.filter((candidate) =>
          matchesReference(reference, candidate),
        );
        if (matches.length !== 1) continue;
        const target = matches[0];
        if (data.some((row) => row.productId === target.id)) continue;
        data.push({
          accessoryId: product.id,
          productId: target.id,
          accessorySignature: compatibilitySignature(product),
          productSignature: compatibilitySignature(target),
          modelCode: reference.code,
          evidenceField: reference.field,
          ruleVersion: COMPATIBILITY_RULE_VERSION,
        });
      }
    }
    // A racing parser edit can make these snapshots stale; signatures on the
    // read side reject them immediately. Replace atomically in both directions.
    if (!data.length) {
      await this.prisma.productCompatibility.deleteMany({
        where: { accessoryId: product.id },
      });
      return 0;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productCompatibility.deleteMany({
        where: { accessoryId: product.id },
      });
      if (data.length)
        await tx.productCompatibility.createMany({
          data,
          skipDuplicates: true,
        });
    });
    return data.length;
  }
}
