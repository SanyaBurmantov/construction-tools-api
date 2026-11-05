import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PlanItem,
  PlanKind,
  PlanStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetrikaService } from '../traffic/metrika.service';
import { TrafficService } from '../traffic/traffic.service';
import { monthStart } from '../traffic/traffic-periods';
import {
  AVERAGE_PROFIT_SHARE,
  isPlanMetric,
  PLAN_METRICS,
  PlanMetricKey,
  planProgress,
} from './plan-metrics';
import { PlanItemDto } from './plans.dto';

/** Fields the AI writes into a product's text (same list as the autopilot's). */
const AI_TEXT_FIELDS = [
  'name',
  'descriptionShort',
  'descriptionFull',
  'seoTitle',
  'seoDescription',
];

/** Open first, then by priority, due date (none last), newest. */
const STATUS_ORDER: Record<PlanStatus, number> = {
  IN_PROGRESS: 0,
  TODO: 1,
  DONE: 2,
  DROPPED: 3,
};

export type PlanItemView = PlanItem & {
  value: number | null;
  progress: number | null;
  tasksTotal: number;
  tasksDone: number;
};

/**
 * «Планы»: the project's goals and to-do list (`/admin/plans`). Small by
 * nature — dozens of rows, read whole — so the list is one query and the
 * goals' measures are counted only for the keys some goal actually uses.
 */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly traffic: TrafficService,
    private readonly metrika: MetrikaService,
  ) {}

  async list(now = new Date()) {
    const rows = await this.prisma.planItem.findMany();
    const used = new Set(
      rows
        .filter((r) => r.kind === PlanKind.GOAL && isPlanMetric(r.metric))
        .map((r) => r.metric as PlanMetricKey),
    );
    const values = await this.metricValues([...used], now);
    const tasks = new Map<string, { total: number; done: number }>();
    for (const r of rows) {
      if (!r.goalId || r.status === PlanStatus.DROPPED) continue;
      const t = tasks.get(r.goalId) ?? { total: 0, done: 0 };
      t.total++;
      if (r.status === PlanStatus.DONE) t.done++;
      tasks.set(r.goalId, t);
    }
    const items: PlanItemView[] = rows
      .map((r) => {
        const value =
          r.kind === PlanKind.GOAL && isPlanMetric(r.metric)
            ? (values.get(r.metric) ?? null)
            : null;
        return {
          ...r,
          value,
          progress: planProgress(value, r.target),
          tasksTotal: tasks.get(r.id)?.total ?? 0,
          tasksDone: tasks.get(r.id)?.done ?? 0,
        };
      })
      .sort(comparePlanItems);
    return { items, metrics: PLAN_METRICS };
  }

  async create(dto: PlanItemDto, createdByName?: string) {
    if (!dto.title) throw new BadRequestException('Нужен заголовок');
    const data = await this.toData(dto, null);
    return this.prisma.planItem.create({
      data: {
        ...(data as Prisma.PlanItemUncheckedCreateInput),
        title: dto.title,
        createdByName: createdByName ?? null,
      },
    });
  }

  async update(id: string, dto: PlanItemDto) {
    const existing = await this.prisma.planItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Пункт плана не найден');
    return this.prisma.planItem.update({
      where: { id },
      data: await this.toData(dto, existing),
    });
  }

  async remove(id: string) {
    // A goal's tasks stay, unlinked (onDelete: SetNull).
    const { count } = await this.prisma.planItem.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Пункт плана не найден');
    return { ok: true };
  }

  /** The DTO as a Prisma update, with the rules a form cannot enforce. */
  private async toData(
    dto: PlanItemDto,
    existing: PlanItem | null,
  ): Promise<Prisma.PlanItemUncheckedUpdateInput> {
    const data: Prisma.PlanItemUncheckedUpdateInput = {};
    const set = <K extends keyof PlanItemDto>(key: K) => {
      if (dto[key] !== undefined) {
        (data as Record<string, unknown>)[key] = dto[key];
      }
    };
    (
      [
        'kind',
        'title',
        'status',
        'area',
        'priority',
        'assignee',
        'metric',
        'target',
      ] as const
    ).forEach(set);
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.assignee !== undefined)
      data.assignee = dto.assignee?.trim() || null;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.attachments !== undefined) {
      data.attachments = dto.attachments.map((a) => ({
        url: a.url,
        name: a.name?.trim() || null,
      }));
    }

    const kind = dto.kind ?? existing?.kind ?? PlanKind.TASK;
    if (dto.goalId !== undefined) {
      if (dto.goalId) {
        if (dto.goalId === existing?.id) {
          throw new BadRequestException('Пункт не может быть своей же целью');
        }
        const goal = await this.prisma.planItem.findUnique({
          where: { id: dto.goalId },
          select: { kind: true },
        });
        if (goal?.kind !== PlanKind.GOAL) {
          throw new BadRequestException('Задачу можно привязать только к цели');
        }
      }
      data.goalId = dto.goalId;
    }
    // A goal belongs to no goal; a task has no measure.
    if (kind === PlanKind.GOAL) data.goalId = null;
    if (kind === PlanKind.TASK) {
      data.metric = null;
      data.target = null;
    }

    if (dto.status !== undefined && dto.status !== existing?.status) {
      data.doneAt = dto.status === PlanStatus.DONE ? new Date() : null;
    }
    return data;
  }

  /** Live values of the given measures; one that fails is just missing. */
  async metricValues(
    keys: PlanMetricKey[],
    now = new Date(),
  ): Promise<Map<PlanMetricKey, number>> {
    const out = new Map<PlanMetricKey, number>();
    const from = monthStart(now, 0);
    const monthOrders = {
      status: { not: OrderStatus.CANCELLED },
      createdAt: { gte: from, lte: now },
    };
    let revenue: Promise<number> | null = null;
    const monthRevenue = () =>
      (revenue ??= this.prisma.order
        .aggregate({ where: monthOrders, _sum: { total: true } })
        .then((r) => r._sum.total ?? 0));

    await Promise.all(
      keys.map(async (key) => {
        try {
          out.set(
            key,
            round2(await this.metricValue(key, monthOrders, monthRevenue, now)),
          );
        } catch (error) {
          this.logger.warn(
            `Plan metric ${key}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }),
    );
    return out;
  }

  private async metricValue(
    key: PlanMetricKey,
    monthOrders: Prisma.OrderWhereInput,
    monthRevenue: () => Promise<number>,
    now: Date,
  ): Promise<number> {
    switch (key) {
      case 'orders_month':
        return this.prisma.order.count({ where: monthOrders });
      case 'company_orders_month':
        return this.prisma.order.count({
          where: {
            ...monthOrders,
            OR: [{ payerName: { not: null } }, { paymentMethod: 'INVOICE' }],
          },
        });
      case 'revenue_month':
        return monthRevenue();
      case 'profit_month':
        return (await monthRevenue()) * AVERAGE_PROFIT_SHARE;
      case 'leads_month':
        return this.prisma.lead.count({
          where: { createdAt: { gte: monthStart(now, 0), lte: now } },
        });
      case 'visits_month': {
        // Metrika has the people-only numbers; our counter when it is off.
        const report = (await this.metrika.report().catch(() => null)) as {
          summary?: { current?: { visits?: number } };
        } | null;
        const fromMetrika = report?.summary?.current?.visits;
        if (typeof fromMetrika === 'number') return fromMetrika;
        return (await this.traffic.summary(now)).current.visits;
      }
      case 'published_products':
        return this.prisma.product.count({
          where: { status: ProductStatus.PUBLISHED },
        });
      case 'ai_text_products':
        return this.prisma.product.count({
          where: { aiLockedFields: { hasSome: AI_TEXT_FIELDS } },
        });
    }
  }
}

export function comparePlanItems(
  a: Pick<PlanItem, 'status' | 'priority' | 'dueDate' | 'createdAt'>,
  b: Pick<PlanItem, 'status' | 'priority' | 'dueDate' | 'createdAt'>,
): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.priority - b.priority ||
    (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
