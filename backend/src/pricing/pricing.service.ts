import { Injectable, Logger } from '@nestjs/common';
import { PricingRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RuleContext,
  computePrice,
  isSuspiciousCostChange,
  margin,
  resolveRule,
} from './pricing.calculator';

/** Rules change rarely but are read on every parsed product. */
const RULES_CACHE_TTL_MS = 60_000;

export type PricingDecision = {
  price: number | null;
  rule: PricingRule | null;
  /** Cost moved so much it looks like an error; the old price is kept. */
  blocked: boolean;
  reason: 'rule' | 'no_rule' | 'blocked_spike' | 'manual';
};

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private rulesCache: { rules: PricingRule[]; expiresAt: number } | null = null;

  constructor(private prisma: PrismaService) {}

  private get spikeThreshold() {
    return Number(process.env.PRICING_SPIKE_THRESHOLD_PERCENT ?? 50);
  }

  async getActiveRules(): Promise<PricingRule[]> {
    const now = Date.now();
    if (this.rulesCache && this.rulesCache.expiresAt > now) {
      return this.rulesCache.rules;
    }
    const rules = await this.prisma.pricingRule.findMany({
      where: { isActive: true },
    });
    this.rulesCache = { rules, expiresAt: now + RULES_CACHE_TTL_MS };
    return rules;
  }

  /** Called after any rule mutation so the next parse sees the change. */
  invalidateRulesCache() {
    this.rulesCache = null;
  }

  /**
   * The product's own category plus every ancestor, so a rule written on a
   * parent category applies to the whole subtree.
   */
  private async categoryChain(categoryId: string | null): Promise<string[]> {
    if (!categoryId) return [];
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, path: true },
    });
    if (!category) return [];

    // `path` holds the slug chain from the root.
    const ancestors = await this.prisma.category.findMany({
      where: { slug: { in: category.path } },
      select: { id: true },
    });
    return [...new Set([category.id, ...ancestors.map((c) => c.id)])];
  }

  /** Decides a price without writing anything. */
  async decide(params: {
    cost: number;
    categoryId: string | null;
    brandId: string | null;
    sourceIds?: string[];
    previousCost?: number | null;
    pricingMode?: 'AUTO' | 'MANUAL';
  }): Promise<PricingDecision> {
    if (params.pricingMode === 'MANUAL') {
      return { price: null, rule: null, blocked: false, reason: 'manual' };
    }

    if (
      isSuspiciousCostChange(
        params.previousCost,
        params.cost,
        this.spikeThreshold,
      )
    ) {
      return {
        price: null,
        rule: null,
        blocked: true,
        reason: 'blocked_spike',
      };
    }

    const [rules, categoryIds] = await Promise.all([
      this.getActiveRules(),
      this.categoryChain(params.categoryId),
    ]);

    const context: RuleContext = {
      categoryIds,
      brandId: params.brandId,
      sourceIds: params.sourceIds ?? [],
    };

    const rule = resolveRule(rules, params.cost, context);
    return {
      price: computePrice(params.cost, rule),
      rule,
      blocked: false,
      reason: rule ? 'rule' : 'no_rule',
    };
  }

  /**
   * Records the supplier cost for a product and updates the storefront price
   * accordingly. Safe to call on every parse: it no-ops for MANUAL products and
   * only writes history when something actually changed.
   */
  async applyCost(
    productId: string,
    cost: number,
    options: { oldCost?: number | null } = {},
  ): Promise<PricingDecision> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        categoryId: true,
        brandId: true,
        costPrice: true,
        priceValue: true,
        oldPrice: true,
        pricingMode: true,
        sourceProducts: { select: { sourceId: true } },
      },
    });

    if (!product) {
      return { price: null, rule: null, blocked: false, reason: 'no_rule' };
    }

    const decision = await this.decide({
      cost,
      categoryId: product.categoryId,
      brandId: product.brandId,
      sourceIds: product.sourceProducts.map((s) => s.sourceId),
      previousCost: product.costPrice,
      pricingMode: product.pricingMode,
    });

    // Hand-priced product: record the new cost so margin stays honest, but
    // leave the price the admin chose alone.
    if (decision.reason === 'manual') {
      if (product.costPrice !== cost) {
        await this.prisma.product.update({
          where: { id: productId },
          data: { costPrice: cost },
        });
      }
      return decision;
    }

    if (decision.blocked) {
      this.logger.warn(
        `Cost jump on product ${productId}: ${product.costPrice} -> ${cost}, price kept for review`,
      );
      await this.prisma.$transaction([
        this.prisma.product.update({
          where: { id: productId },
          data: { priceReviewNeeded: true },
        }),
        this.prisma.priceHistory.create({
          data: {
            productId,
            costPrice: cost,
            oldPrice: product.priceValue,
            newPrice: product.priceValue,
            reason: 'blocked_spike',
          },
        }),
      ]);
      return decision;
    }

    // A supplier's own "was" price has to go through the same markup, otherwise
    // it would sit below our marked-up price and the discount badge would
    // either vanish or misrepresent a saving that isn't ours.
    const oldPrice =
      options.oldCost != null && options.oldCost > cost
        ? computePrice(options.oldCost, decision.rule)
        : null;

    const costChanged = product.costPrice !== cost;
    const priceChanged = product.priceValue !== decision.price;
    // Also write when the "was" price needs clearing: a supplier that stopped
    // discounting would otherwise leave a phantom discount on the card forever.
    const oldPriceChanged = product.oldPrice !== oldPrice;
    if (!costChanged && !priceChanged && !oldPriceChanged) return decision;

    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: productId },
        data: {
          costPrice: cost,
          priceValue: decision.price,
          oldPrice,
          appliedRuleId: decision.rule?.id ?? null,
        },
      }),
      this.prisma.priceHistory.create({
        data: {
          productId,
          costPrice: cost,
          oldPrice: product.priceValue,
          newPrice: decision.price,
          reason: decision.reason,
          ruleId: decision.rule?.id ?? null,
        },
      }),
    ]);

    return decision;
  }

  /** Simulator for the admin: what would this cost be priced at? */
  async preview(params: {
    cost: number;
    categoryId?: string | null;
    brandId?: string | null;
    sourceId?: string | null;
  }) {
    const decision = await this.decide({
      cost: params.cost,
      categoryId: params.categoryId ?? null,
      brandId: params.brandId ?? null,
      sourceIds: params.sourceId ? [params.sourceId] : [],
    });

    return {
      cost: params.cost,
      price: decision.price,
      rule: decision.rule
        ? {
            id: decision.rule.id,
            name: decision.rule.name,
            scope: decision.rule.scope,
          }
        : null,
      margin: margin(decision.price, params.cost),
    };
  }

  /**
   * Re-prices every AUTO product that has a cost. Runs in batches so a large
   * catalogue doesn't hold the event loop or a single transaction.
   */
  async recalculateAll(filter: { categoryId?: string; brandId?: string } = {}) {
    this.invalidateRulesCache();

    const where = {
      pricingMode: 'AUTO' as const,
      costPrice: { not: null },
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.brandId ? { brandId: filter.brandId } : {}),
    };

    const total = await this.prisma.product.count({ where });
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.product.findMany({
        where,
        select: { id: true, costPrice: true, priceValue: true },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!batch.length) break;

      for (const product of batch) {
        // The cost hasn't moved, so the spike guard can't trip here — this only
        // re-applies whatever the rules now say.
        const before = product.priceValue;
        const decision = await this.applyCost(product.id, product.costPrice!);
        processed += 1;
        if (decision.price !== before) updated += 1;
      }

      cursor = batch[batch.length - 1].id;
    }

    return { total, processed, updated };
  }

  /**
   * Resolves a flagged product.
   *
   * `accept: true` means the admin looked at the suspicious cost and confirmed
   * it is real — the pending cost (kept only in history, since applyCost
   * deliberately never wrote it to the product) is adopted and the price is
   * recomputed. `accept: false` just clears the flag and keeps the old price.
   */
  async confirmReviewed(productId: string, accept: boolean) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        categoryId: true,
        brandId: true,
        costPrice: true,
        priceValue: true,
        sourceProducts: { select: { sourceId: true } },
      },
    });
    if (!product) return { ok: false as const };

    if (!accept) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { priceReviewNeeded: false },
      });
      return { ok: true as const, price: product.priceValue };
    }

    // The rejected cost lives in the audit trail, not on the product.
    const pending = await this.prisma.priceHistory.findFirst({
      where: { productId, reason: 'blocked_spike' },
      orderBy: { createdAt: 'desc' },
      select: { costPrice: true },
    });
    const cost = pending?.costPrice ?? product.costPrice;
    if (cost == null) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { priceReviewNeeded: false },
      });
      return { ok: true as const, price: product.priceValue };
    }

    const decision = await this.decide({
      cost,
      categoryId: product.categoryId,
      brandId: product.brandId,
      sourceIds: product.sourceProducts.map((s) => s.sourceId),
      // No previousCost: the admin has already vouched for this jump, so the
      // spike guard must not block it a second time.
    });

    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: productId },
        data: {
          costPrice: cost,
          priceValue: decision.price,
          appliedRuleId: decision.rule?.id ?? null,
          priceReviewNeeded: false,
        },
      }),
      this.prisma.priceHistory.create({
        data: {
          productId,
          costPrice: cost,
          oldPrice: product.priceValue,
          newPrice: decision.price,
          reason: 'manual',
          ruleId: decision.rule?.id ?? null,
        },
      }),
    ]);

    return { ok: true as const, price: decision.price };
  }

  /**
   * Adoption step for a catalogue that predates this engine: products already
   * have a storefront price but no cost. Treats the current price as the
   * supplier cost so the markup rules have something to work from.
   *
   * Only touches products whose cost is still unknown, so it is safe to re-run
   * and never overwrites a cost a parser has since recorded.
   */
  async backfillCostFromPrice() {
    const result = await this.prisma.$executeRaw`
      UPDATE "Product"
      SET "costPrice" = "priceValue"
      WHERE "costPrice" IS NULL
        AND "priceValue" IS NOT NULL
        AND "priceValue" > 0
    `;
    return { updated: result };
  }

  /** Products whose cost jumped suspiciously and are waiting on a decision. */
  async reviewQueue(limit = 50) {
    const products = await this.prisma.product.findMany({
      where: { priceReviewNeeded: true },
      select: {
        id: true,
        name: true,
        slug: true,
        costPrice: true,
        priceValue: true,
        priceCurrency: true,
        updatedAt: true,
        priceHistory: {
          where: { reason: 'blocked_spike' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { costPrice: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 200),
    });

    return {
      data: products.map((product) => ({
        ...product,
        pendingCost: product.priceHistory[0]?.costPrice ?? null,
        flaggedAt: product.priceHistory[0]?.createdAt ?? null,
      })),
    };
  }

  getHistory(productId: string, limit = 50) {
    return this.prisma.priceHistory.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }
}
