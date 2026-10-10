import { Injectable, Logger } from '@nestjs/common';
import { UserListKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withoutPlaceholderImages } from '../common/utils/product-images';
import { UserListsDto } from './dto/user-lists.dto';

export type UserListLine = {
  productId: string;
  slug: string;
  name: string;
  image: string | null;
  price: number | null;
  oldPrice: number | null;
  currency: string;
  stockStatus: string | null;
  categorySlug: string | null;
  categoryName: string | null;
};

export type UserLists = {
  wishlist: UserListLine[];
  compare: UserListLine[];
};

/** Mirrors COMPARE_LIMIT on the storefront: more columns stop being readable. */
const COMPARE_LIMIT = 4;
/** The wishlist cap the client already enforces. */
const WISHLIST_LIMIT = 200;
const DEFAULT_TTL_DAYS = 365;

const LIMITS: Record<UserListKind, number> = {
  [UserListKind.WISHLIST]: WISHLIST_LIMIT,
  [UserListKind.COMPARE]: COMPARE_LIMIT,
};

/**
 * Favourites and comparison, stored for a signed-in account.
 *
 * Deliberately the same shape as the stored cart (`cart/server-cart.service.ts`):
 * only product ids are kept, prices are read from `Product` on every serve,
 * the localStorage lists stay what the UI renders, and the sync is
 * merge-on-sign-in + replace-on-change. Keeping the two features identical
 * means one mental model instead of two — the only difference here is that a
 * list is a set, so there are no quantities to reconcile.
 */
@Injectable()
export class UserListsService {
  private readonly logger = new Logger(UserListsService.name);

  constructor(private prisma: PrismaService) {}

  /** Which of these ids may be in a list at all. */
  private async orderableIds(productIds: string[]): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'PUBLISHED' },
      select: { id: true },
    });
    return new Set(products.map((product) => product.id));
  }

  private line(product: {
    id: string;
    slug: string;
    name: string;
    priceValue: number | null;
    oldPrice: number | null;
    priceCurrency: string | null;
    stockStatus: string | null;
    images: Array<{ url: string; isPlaceholder?: boolean }>;
    category: { slug: string; name: string } | null;
  }): UserListLine {
    return {
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: withoutPlaceholderImages(product.images)[0]?.url ?? null,
      price: product.priceValue,
      oldPrice:
        product.oldPrice != null &&
        product.priceValue != null &&
        product.oldPrice > product.priceValue
          ? product.oldPrice
          : null,
      currency: product.priceCurrency ?? 'BYN',
      stockStatus: product.stockStatus,
      categorySlug: product.category?.slug ?? null,
      categoryName: product.category?.name ?? null,
    };
  }

  /**
   * Both lists in one response: the storefront restores them together on
   * sign-in, and two round trips for two sets of ids buys nothing.
   */
  async getLists(userId: string): Promise<UserLists> {
    const rows = await this.prisma.userListItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          include: {
            images: { orderBy: { order: 'asc' } },
            category: { select: { slug: true, name: true } },
          },
        },
      },
    });

    const wishlist: UserListLine[] = [];
    const compare: UserListLine[] = [];
    const stale: string[] = [];

    for (const row of rows) {
      if (row.product.status !== 'PUBLISHED') {
        stale.push(row.id);
        continue;
      }
      const line = this.line(row.product);
      if (row.kind === UserListKind.WISHLIST) wishlist.push(line);
      else compare.push(line);
    }

    // A line we refuse to serve should not be stored either.
    if (stale.length) {
      await this.prisma.userListItem
        .deleteMany({ where: { id: { in: stale } } })
        .catch(() => undefined);
    }

    return {
      wishlist: wishlist.slice(0, WISHLIST_LIMIT),
      // Comparison is ordered oldest-first on the storefront, and the cap
      // applies to what was added first, not last.
      compare: compare.reverse().slice(0, COMPARE_LIMIT),
    };
  }

  private async writeKind(
    userId: string,
    kind: UserListKind,
    productIds: string[],
    mode: 'replace' | 'merge',
  ) {
    const wanted = [...new Set(productIds)];
    const orderable = await this.orderableIds(wanted);
    const keep = wanted.filter((id) => orderable.has(id));

    if (mode === 'replace') {
      await this.prisma.$transaction([
        this.prisma.userListItem.deleteMany({ where: { userId, kind } }),
        ...(keep.length
          ? [
              this.prisma.userListItem.createMany({
                data: keep
                  .slice(0, LIMITS[kind])
                  .map((productId) => ({ userId, kind, productId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
      return;
    }

    // Merge: a union, capped. Which rows survive the cap matters for
    // comparison — the four already stored win over newly arrived ones, so
    // signing in never silently reshuffles the table being compared.
    const existing = await this.prisma.userListItem.findMany({
      where: { userId, kind },
      select: { productId: true },
    });
    const have = new Set(existing.map((row) => row.productId));
    const room = Math.max(0, LIMITS[kind] - have.size);
    const toAdd = keep.filter((id) => !have.has(id)).slice(0, room);

    if (toAdd.length) {
      await this.prisma.userListItem.createMany({
        data: toAdd.map((productId) => ({ userId, kind, productId })),
        skipDuplicates: true,
      });
    }
  }

  /** Sign-in step: union of what the browser holds and what was stored. */
  async merge(userId: string, dto: UserListsDto): Promise<UserLists> {
    await this.writeKind(
      userId,
      UserListKind.WISHLIST,
      dto.wishlist ?? [],
      'merge',
    );
    await this.writeKind(
      userId,
      UserListKind.COMPARE,
      dto.compare ?? [],
      'merge',
    );
    return this.getLists(userId);
  }

  /** Mirrors a local change up. Last write wins, as with the cart. */
  async replace(userId: string, dto: UserListsDto): Promise<UserLists> {
    if (dto.wishlist) {
      await this.writeKind(
        userId,
        UserListKind.WISHLIST,
        dto.wishlist,
        'replace',
      );
    }
    if (dto.compare) {
      await this.writeKind(
        userId,
        UserListKind.COMPARE,
        dto.compare,
        'replace',
      );
    }
    return this.getLists(userId);
  }

  async clear(userId: string, kind?: UserListKind) {
    const { count } = await this.prisma.userListItem.deleteMany({
      where: { userId, ...(kind ? { kind } : {}) },
    });
    return { ok: true, removed: count };
  }

  /** Called by the cleanup cron; `LIST_TTL_DAYS` defaults to a year. */
  async purgeStale() {
    const days = Number(process.env.LIST_TTL_DAYS);
    const ttlDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.userListItem.deleteMany({
      where: { createdAt: { lte: cutoff } },
    });
    if (count) this.logger.log(`Removed ${count} stale list item(s)`);
    return count;
  }
}
