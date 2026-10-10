import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OrderStatus, Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { AdminReviewQueryDto, ReviewQueryDto } from './dto/review-query.dto';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REVIEWS_PER_IP_PER_DAY = 5;

/**
 * The single response for every accepted submission. Rejected-but-silent cases
 * (honeypot, duplicate text) return this too, so a bot can't tell them apart
 * from success.
 */
const SUBMIT_RESPONSE = {
  ok: true,
  message: 'Спасибо! Отзыв отправлен на модерацию.',
} as const;

/**
 * Fields safe to expose publicly — author email is never returned, and
 * neither is the account behind the review: `isVerifiedPurchase` is the only
 * thing a reader needs to know about it.
 */
const PUBLIC_SELECT = {
  id: true,
  authorName: true,
  rating: true,
  title: true,
  text: true,
  isVerifiedPurchase: true,
  createdAt: true,
} satisfies Prisma.ReviewSelect;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private prisma: PrismaService) {}

  private async getPublishedProduct(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  /**
   * Pseudonymizes an IP for rate-limiting. The raw address is never stored —
   * only a salted hash, which is enough to spot repeats but not to recover the
   * address. Salt falls back to ADMIN_TOKEN so there's no new required secret.
   */
  private hashIp(ip: string | undefined): string | null {
    if (!ip) return null;
    const salt = process.env.REVIEW_IP_SALT || process.env.ADMIN_TOKEN || '';
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
  }

  /**
   * Guest submission. Always lands in PENDING — nothing a visitor writes shows
   * up on the storefront or moves the rating until an admin approves it.
   *
   * Spam defence, in order of cost: honeypot (free), then per-IP and duplicate
   * checks (one indexed query each). The route also carries a strict throttle.
   */
  /**
   * Did this account actually buy this product? Checked once, at submission,
   * and stored as a snapshot on the review.
   */
  private async hasPurchased(userId: string, productId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        userId,
        status: { not: OrderStatus.CANCELLED },
        items: { some: { productId } },
      },
      select: { id: true },
    });
    return Boolean(order);
  }

  /**
   * `userId` is set when the submitter was signed in. It changes the spam
   * defence rather than adding to it: an account is a far better identity than
   * an IP, so the per-IP limits — the ones that misfire behind carrier-grade
   * NAT, where several customers share one address — are replaced by "one
   * review per product per account".
   */
  async create(
    slug: string,
    dto: CreateReviewDto,
    ip?: string,
    userId?: string,
  ) {
    const product = await this.getPublishedProduct(slug);

    // Honeypot tripped. Answer exactly as if it worked — telling a bot it was
    // detected just teaches it which field to leave alone next time.
    if (dto.website?.trim()) {
      this.logger.warn(`Honeypot tripped on review for ${slug}`);
      return SUBMIT_RESPONSE;
    }

    const ipHash = this.hashIp(ip);
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);

    if (userId) {
      // No time window here: a second review of the same product from the same
      // account is an edit, not a new opinion.
      const own = await this.prisma.review.findFirst({
        where: { productId: product.id, userId },
        select: { id: true, status: true },
      });
      if (own) {
        throw new BadRequestException(
          own.status === ReviewStatus.PENDING
            ? 'Вы уже оставили отзыв на этот товар — он ждёт проверки модератором.'
            : 'Вы уже оставили отзыв на этот товар.',
        );
      }
    } else if (ipHash) {
      // One review per product per IP per day.
      const alreadyReviewed = await this.prisma.review.findFirst({
        where: { productId: product.id, ipHash, createdAt: { gte: since } },
        select: { id: true },
      });
      if (alreadyReviewed) {
        throw new BadRequestException(
          'Вы уже оставили отзыв на этот товар. Он появится после проверки модератором.',
        );
      }

      // A burst across different products is the other common spam shape.
      const recentCount = await this.prisma.review.count({
        where: { ipHash, createdAt: { gte: since } },
      });
      if (recentCount >= MAX_REVIEWS_PER_IP_PER_DAY) {
        throw new BadRequestException(
          'Слишком много отзывов за сутки. Попробуйте завтра.',
        );
      }
    }

    const text = dto.text.trim();

    // Identical text on the same product — catches distributed spam that
    // rotates IPs but reuses the payload.
    const duplicateText = await this.prisma.review.findFirst({
      where: { productId: product.id, text, createdAt: { gte: since } },
      select: { id: true },
    });
    if (duplicateText) {
      // Silently accept: a rotating-IP bot learns nothing from a success.
      this.logger.warn(`Duplicate review text dropped for ${slug}`);
      return SUBMIT_RESPONSE;
    }

    await this.prisma.review.create({
      data: {
        productId: product.id,
        userId: userId ?? null,
        isVerifiedPurchase: userId
          ? await this.hasPurchased(userId, product.id)
          : false,
        authorName: dto.authorName.trim(),
        authorEmail: dto.authorEmail?.trim() || null,
        rating: dto.rating,
        title: dto.title?.trim() || null,
        text,
        status: ReviewStatus.PENDING,
        ipHash,
      },
    });

    return SUBMIT_RESPONSE;
  }

  async listForProduct(slug: string, query: ReviewQueryDto) {
    const product = await this.getPublishedProduct(slug);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 50);
    const where: Prisma.ReviewWhereInput = {
      productId: product.id,
      status: ReviewStatus.APPROVED,
    };

    const [data, total, summary] = await Promise.all([
      this.prisma.review.findMany({
        where,
        select: PUBLIC_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      }),
      this.prisma.review.count({ where }),
      this.ratingSummary(product.id),
    ]);

    return {
      data,
      summary,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /** Average, count and the 1..5 histogram used by the rating breakdown bars. */
  private async ratingSummary(productId: string) {
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: ReviewStatus.APPROVED },
      _count: { rating: true },
    });

    const distribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    let total = 0;
    let sum = 0;
    for (const row of grouped) {
      distribution[row.rating] = row._count.rating;
      total += row._count.rating;
      sum += row.rating * row._count.rating;
    }

    return {
      average: total ? Math.round((sum / total) * 10) / 10 : null,
      count: total,
      distribution,
    };
  }

  /**
   * Recomputes the denormalized aggregate on Product. Called after every
   * moderation action so the storefront card and the reviews block agree.
   */
  private async syncProductRating(productId: string) {
    const { average, count } = await this.ratingSummary(productId);
    await this.prisma.product.update({
      where: { id: productId },
      data: { ratingAvg: average, ratingCount: count },
    });
  }

  async adminList(query: AdminReviewQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);

    const where: Prisma.ReviewWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { authorName: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { text: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total, pending] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              images: { orderBy: { order: 'asc' }, take: 1 },
            },
          },
          user: { select: { id: true, login: true } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.count({ where: { status: ReviewStatus.PENDING } }),
    ]);

    return {
      data,
      pendingCount: pending,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async setStatus(id: string, status: ReviewStatus) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Отзыв не найден');

    const updated = await this.prisma.review.update({
      where: { id },
      data: { status, moderatedAt: new Date() },
    });
    await this.syncProductRating(review.productId);
    return updated;
  }

  async remove(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Отзыв не найден');

    await this.prisma.review.delete({ where: { id } });
    await this.syncProductRating(review.productId);
    return { ok: true };
  }
}
