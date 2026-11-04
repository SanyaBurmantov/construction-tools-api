import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { servesHttp } from '../common/utils/process-role';
import {
  KEY_HEADER_CATEGORIES,
  parseStoredConfig,
} from '../storefront/storefront-config';
import { ProductFilterDto } from './dto/product-filter-dto';
import { FACETS_CACHE_TTL_MS, ProductService } from './products.service';

/** How often the popular listings are refreshed; well inside the TTL. */
export const WARMUP_EVERY_MS = 10 * 60_000;
/** A listing computed less than this ago is left alone. */
const REFRESH_OLDER_THAN_MS = FACETS_CACHE_TTL_MS - WARMUP_EVERY_MS;
const FIRST_RUN_MS = 60_000;
/** Bounded: the cache holds 300 filter sets, and each warm-up is ~0.5 s of DB. */
export const MAX_WARMUP_CATEGORIES = 40;
/** One storefront page of the catalogue, as CatalogView asks for it. */
const PAGE_SIZE = 24;

/**
 * Which category pages to keep warm: the ones every visitor can reach in one
 * click — the header strip an admin curated, the home page's featured tiles,
 * the root categories of the menu — in that order, without repeats. Pure.
 */
export function warmupTargets(input: {
  headerCategoryIds: string[];
  featured: Array<{ id: string; slug: string }>;
  roots: Array<{ id: string; slug: string }>;
  slugById: Map<string, string>;
}): string[] {
  const slugs: string[] = [];
  const add = (slug: string | undefined) => {
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  };
  for (const id of input.headerCategoryIds) add(input.slugById.get(id));
  for (const category of input.featured) add(category.slug);
  for (const category of input.roots) add(category.slug);
  return slugs.slice(0, MAX_WARMUP_CATEGORIES);
}

/**
 * Keeps the total + facets of the most visited listings computed, in the API
 * process — the cache lives in its memory, so the worker could not warm it.
 * Every WARMUP_EVERY_MS, one listing at a time (never a burst on the DB):
 * the whole catalogue, then each target category's first page. A listing a
 * visitor already refreshed recently is skipped by the age check.
 */
@Injectable()
export class FacetsWarmupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FacetsWarmupService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductService,
  ) {}

  onModuleInit() {
    if (!servesHttp()) return;
    const tick = () => {
      void this.warm().finally(() => {
        this.timer = setTimeout(tick, WARMUP_EVERY_MS);
        this.timer.unref?.();
      });
    };
    this.timer = setTimeout(tick, FIRST_RUN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  async warm(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let warmed = 0;
    try {
      const slugs = await this.targets();
      const listings: ProductFilterDto[] = [
        {} as ProductFilterDto,
        ...slugs.map((categorySlug) => ({ categorySlug }) as ProductFilterDto),
      ];
      for (const filter of listings) {
        try {
          await this.products.findAllFiltered(
            { ...filter, page: 1, limit: PAGE_SIZE } as ProductFilterDto,
            { refreshSummaryOlderThanMs: REFRESH_OLDER_THAN_MS },
          );
          warmed += 1;
        } catch (error) {
          // A category that vanished since the list was read is not an outage.
          this.logger.warn(
            `Facets warm-up of ${filter.categorySlug ?? 'catalogue'} failed: ${String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(`Facets warm-up skipped: ${String(error)}`);
    } finally {
      this.running = false;
    }
    return warmed;
  }

  private async targets(): Promise<string[]> {
    const [setting, featured, roots] = await Promise.all([
      this.prisma.siteSetting.findUnique({
        where: { key: KEY_HEADER_CATEGORIES },
      }),
      this.prisma.category.findMany({
        where: { isFeatured: true, isVisible: true },
        select: { id: true, slug: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.category.findMany({
        where: { parentId: null, isVisible: true },
        select: { id: true, slug: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const header = parseStoredConfig(
      new Map(setting ? [[setting.key, setting.value]] : []),
    ).headerCategories.map((entry) => entry.categoryId);
    const headerRows = header.length
      ? await this.prisma.category.findMany({
          where: { id: { in: header }, isVisible: true },
          select: { id: true, slug: true },
        })
      : [];
    return warmupTargets({
      headerCategoryIds: header,
      featured,
      roots,
      slugById: new Map(headerRows.map((row) => [row.id, row.slug])),
    });
  }
}
