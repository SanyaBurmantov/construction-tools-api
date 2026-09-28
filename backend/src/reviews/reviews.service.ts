import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { AdminReviewQueryDto, ReviewQueryDto } from './dto/review-query.dto';

/** Fields safe to expose publicly — author email is never returned. */
const PUBLIC_SELECT = {
  id: true,
  authorName: true,
  rating: true,
  title: true,
  text: true,
  createdAt: true,
} satisfies Prisma.ReviewSelect;

@Injectable()
export class ReviewsService {
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
   * Guest submission. Always lands in PENDING — nothing a visitor writes shows
   * up on the storefront or moves the rating until an admin approves it.
   */
  async create(slug: string, dto: CreateReviewDto) {
    const product = await this.getPublishedProduct(slug);

    await this.prisma.review.create({
      data: {
        productId: product.id,
        authorName: dto.authorName.trim(),
        authorEmail: dto.authorEmail?.trim() || null,
        rating: dto.rating,
        title: dto.title?.trim() || null,
        text: dto.text.trim(),
        status: ReviewStatus.PENDING,
      },
    });

    return {
      ok: true,
      message: 'Спасибо! Отзыв отправлен на модерацию.',
    };
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
