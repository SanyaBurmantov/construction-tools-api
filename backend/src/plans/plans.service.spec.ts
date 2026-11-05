import { BadRequestException } from '@nestjs/common';
import { PlanKind, PlanStatus } from '@prisma/client';
import { planProgress } from './plan-metrics';
import { comparePlanItems, PlansService } from './plans.service';

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  kind: PlanKind.TASK,
  title: 'Задача',
  description: null,
  status: PlanStatus.TODO,
  area: 'OTHER',
  priority: 2,
  dueDate: null,
  assignee: null,
  metric: null,
  target: null,
  goalId: null,
  attachments: [],
  doneAt: null,
  createdByName: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

function makeService(rows: ReturnType<typeof item>[] = []) {
  const prisma = {
    planItem: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }) => Promise.resolve(data)),
      update: jest.fn(({ data }) => Promise.resolve(data)),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue({ _sum: { total: 1000 } }),
    },
    lead: { count: jest.fn().mockResolvedValue(4) },
    product: { count: jest.fn().mockResolvedValue(7) },
  };
  const traffic = {
    summary: jest.fn().mockResolvedValue({ current: { visits: 11 } }),
  };
  const metrika = {
    report: jest.fn().mockResolvedValue({ configured: false }),
  };
  const service = new PlansService(
    prisma as never,
    traffic as never,
    metrika as never,
  );
  return { service, prisma, traffic, metrika };
}

describe('planProgress', () => {
  it('is the share of the target, capped at 1', () => {
    expect(planProgress(5, 10)).toBe(0.5);
    expect(planProgress(15, 10)).toBe(1);
    expect(planProgress(5, null)).toBeNull();
    expect(planProgress(5, 0)).toBeNull();
    expect(planProgress(null, 10)).toBeNull();
  });
});

describe('comparePlanItems', () => {
  it('puts work in progress first, then priority, then the nearest due date', () => {
    const rows = [
      item({ id: 'done', status: PlanStatus.DONE, priority: 1 }),
      item({ id: 'low', priority: 3 }),
      item({ id: 'late', dueDate: new Date('2026-12-01') }),
      item({ id: 'soon', dueDate: new Date('2026-11-10') }),
      item({ id: 'doing', status: PlanStatus.IN_PROGRESS, priority: 3 }),
    ];
    expect(rows.sort(comparePlanItems as never).map((r) => r.id)).toEqual([
      'doing',
      'soon',
      'late',
      'low',
      'done',
    ]);
  });
});

describe('PlansService', () => {
  it('counts a goal measure live and the goal’s tasks', async () => {
    const goal = item({
      id: 'a1b2c3d4-0000-4000-8000-00000000000a',
      kind: PlanKind.GOAL,
      metric: 'profit_month',
      target: 300,
    });
    const rows = [
      goal,
      item({ id: 't1', goalId: goal.id, status: PlanStatus.DONE }),
      item({ id: 't2', goalId: goal.id }),
      item({ id: 't3', goalId: goal.id, status: PlanStatus.DROPPED }),
    ];
    const { service } = makeService(rows);
    const { items } = await service.list(new Date('2026-11-05T12:00:00Z'));
    const view = items.find((i) => i.id === goal.id)!;
    expect(view.value).toBe(150); // 15% of 1000 BYN
    expect(view.progress).toBe(0.5);
    expect(view.tasksTotal).toBe(2);
    expect(view.tasksDone).toBe(1);
  });

  it('falls back to our own counter when Metrika is not connected', async () => {
    const { service, traffic } = makeService();
    const values = await service.metricValues(['visits_month']);
    expect(values.get('visits_month')).toBe(11);
    expect(traffic.summary).toHaveBeenCalled();
  });

  it('stamps doneAt when a task is done and clears it when reopened', async () => {
    const task = item();
    const { service, prisma } = makeService([task]);
    await service.update(task.id, { status: PlanStatus.DONE });
    expect(prisma.planItem.update.mock.calls[0][0].data.doneAt).toBeInstanceOf(
      Date,
    );
    const done = item({ status: PlanStatus.DONE, doneAt: new Date() });
    const second = makeService([done]);
    await second.service.update(done.id, { status: PlanStatus.TODO });
    expect(
      second.prisma.planItem.update.mock.calls[0][0].data.doneAt,
    ).toBeNull();
  });

  it('links a task only to a goal and drops a measure from a task', async () => {
    const otherTask = item({ id: 'a1b2c3d4-0000-4000-8000-00000000000b' });
    const task = item();
    const { service, prisma } = makeService([task, otherTask]);
    await expect(
      service.update(task.id, { goalId: otherTask.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.update(task.id, { metric: 'orders_month', target: 5 });
    const data = prisma.planItem.update.mock.calls[0][0].data;
    expect(data.metric).toBeNull();
    expect(data.target).toBeNull();
  });

  it('keeps a goal free of a parent goal', async () => {
    const goal = item({ kind: PlanKind.GOAL });
    const other = item({
      id: 'a1b2c3d4-0000-4000-8000-00000000000c',
      kind: PlanKind.GOAL,
    });
    const { service, prisma } = makeService([goal, other]);
    await service.update(goal.id, { goalId: other.id });
    expect(prisma.planItem.update.mock.calls[0][0].data.goalId).toBeNull();
  });
});
