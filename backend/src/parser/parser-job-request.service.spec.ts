import {
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ParserJobRequestService } from './parser-job-request.service';
import { JobOutcome, ParserJobsService } from './parser-jobs.service';
import { WORKER_HEARTBEAT_KEY } from './worker-heartbeat';

type Row = {
  id: string;
  sourceCode: string;
  jobName: string;
  params: unknown;
  status: 'PENDING' | 'TAKEN' | 'DONE' | 'FAILED';
  result?: unknown;
  error?: string | null;
  createdAt: Date;
};

type Where = {
  id?: string;
  status?: string | { in: string[] };
  sourceCode?: string;
  jobName?: string;
};

const matches = (row: Row, where: Where) =>
  (where.id === undefined || row.id === where.id) &&
  (where.sourceCode === undefined || row.sourceCode === where.sourceCode) &&
  (where.jobName === undefined || row.jobName === where.jobName) &&
  (where.status === undefined ||
    (typeof where.status === 'string'
      ? row.status === where.status
      : where.status.in.includes(row.status)));

/** Just enough of Prisma for the request table, held in memory. */
function fakePrisma(
  options: { workerAlive?: boolean; runningKey?: string } = {},
) {
  const rows: Row[] = [];
  let seq = 0;
  const prisma = {
    rows,
    siteSetting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          where.key === WORKER_HEARTBEAT_KEY && options.workerAlive !== false
            ? { value: new Date().toISOString() }
            : null,
        ),
      ),
    },
    parserRuntimeStatus: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          options.runningKey ? { key: options.runningKey } : null,
        ),
      ),
    },
    parserJobRequest: {
      create: jest.fn(({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `r${++seq}`,
          sourceCode: data.sourceCode!,
          jobName: data.jobName!,
          params: data.params,
          status: 'PENDING',
          createdAt: new Date(),
        };
        rows.push(row);
        return Promise.resolve({ id: row.id });
      }),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((row) => row.id === where.id) ?? null),
      ),
      findFirst: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(rows.filter((row) => matches(row, where))),
      ),
      count: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(rows.filter((row) => matches(row, where)).length),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Where; data: Partial<Row> }) => {
          // The expiry sweep filters on createdAt; nothing here is that old.
          if ('createdAt' in where) return Promise.resolve({ count: 0 });
          const hit = rows.filter((row) => matches(row, where));
          hit.forEach((row) => Object.assign(row, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          const row = rows.find((item) => item.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  };
  return prisma;
}

function fakeJobs(outcome: JobOutcome = { ok: true, result: { done: 1 } }) {
  const job = {
    name: 'process',
    label: 'Разобрать пачку',
    description: '',
    run: jest.fn(() => Promise.resolve('ran in place')),
  };
  return {
    job,
    findJob: jest.fn((code: string, name: string) =>
      code === 'dukon' && name === 'process' ? job : undefined,
    ),
    start: jest.fn(() => ({ started: true, key: 'dukon-process' })),
    runExclusive: jest.fn(
      (_code: string, _name: string, _label: string, run: () => unknown) =>
        run(),
    ),
    runRequested: jest.fn(() => Promise.resolve(outcome)),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ParserJobRequestService', () => {
  const original = process.env.PROCESS_ROLE;
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original;
  });

  const create = (prisma = fakePrisma(), jobs = fakeJobs()) => ({
    prisma,
    jobs,
    service: new ParserJobRequestService(
      prisma as never,
      jobs as unknown as ParserJobsService,
    ),
  });

  describe('in a single process (dev)', () => {
    beforeEach(() => delete process.env.PROCESS_ROLE);

    it('runs the job in place and writes no request', async () => {
      const { service, prisma, jobs } = create();

      await service.start('dukon', 'process');
      await expect(
        service.runAndWait('dukon', 'process', { limit: 5 }),
      ).resolves.toBe('ran in place');

      expect(jobs.start).toHaveBeenCalledWith('dukon', 'process', undefined);
      expect(jobs.job.run).toHaveBeenCalledWith({ limit: 5 });
      expect(prisma.rows).toHaveLength(0);
    });
  });

  describe('in the API process', () => {
    beforeEach(() => (process.env.PROCESS_ROLE = 'api'));

    it('hands the job to the worker instead of running it', async () => {
      const { service, prisma, jobs } = create();

      await expect(service.start('dukon', 'process')).resolves.toEqual({
        started: true,
        key: 'dukon-process',
      });
      expect(jobs.start).not.toHaveBeenCalled();
      expect(prisma.rows).toMatchObject([
        { sourceCode: 'dukon', jobName: 'process', status: 'PENDING' },
      ]);
    });

    it('answers already-running while the source is busy', async () => {
      const { service, prisma } = create(
        fakePrisma({ runningKey: 'dukon-refresh' }),
      );

      await expect(service.start('dukon', 'process')).resolves.toEqual({
        started: false,
        key: 'dukon-refresh',
        reason: 'already-running',
      });
      await expect(service.runAndWait('dukon', 'process')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.rows).toHaveLength(0);
    });

    it('treats an unfinished request as a busy source', async () => {
      const { service } = create();

      await service.start('dukon', 'process');
      await expect(service.start('dukon', 'process')).resolves.toMatchObject({
        started: false,
        reason: 'already-running',
      });
      await expect(service.hasOpenRequest('dukon', 'process')).resolves.toBe(
        true,
      );
    });

    it('refuses at once when no worker is alive to pick it up', async () => {
      const { service, prisma } = create(fakePrisma({ workerAlive: false }));

      await expect(service.start('dukon', 'process')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(prisma.rows).toHaveLength(0);
    });

    it('waits for the worker and returns its result', async () => {
      jest.useFakeTimers();
      const { service, prisma } = create();

      const waiting = service.runAndWait('dukon', 'process', { limit: 25 });
      await jest.advanceTimersByTimeAsync(0);
      expect(prisma.rows[0].params).toEqual({ limit: 25 });

      Object.assign(prisma.rows[0], { status: 'DONE', result: { saved: 25 } });
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(waiting).resolves.toEqual({ saved: 25 });
    });

    it('turns a failed request into an error with its message', async () => {
      jest.useFakeTimers();
      const { service, prisma } = create();

      const waiting = service.runAndWait('dukon', 'process');
      const assertion = expect(waiting).rejects.toThrow(
        new InternalServerErrorException('supplier down'),
      );
      await jest.advanceTimersByTimeAsync(0);
      Object.assign(prisma.rows[0], {
        status: 'FAILED',
        error: 'supplier down',
      });
      await jest.advanceTimersByTimeAsync(2_000);

      await assertion;
    });
  });

  describe('in the worker', () => {
    beforeEach(() => (process.env.PROCESS_ROLE = 'worker'));

    it('claims a pending request, runs it and records the outcome', async () => {
      const prisma = fakePrisma();
      const jobs = fakeJobs({ ok: true, result: { saved: 5 } });
      const { service } = create(prisma, jobs);
      prisma.rows.push({
        id: 'r1',
        sourceCode: 'dukon',
        jobName: 'process',
        params: { limit: 5 },
        status: 'PENDING',
        createdAt: new Date(),
      });

      await service.poll();
      await flush();

      expect(jobs.runRequested).toHaveBeenCalledWith('dukon', 'process', {
        limit: 5,
      });
      expect(prisma.rows[0]).toMatchObject({
        status: 'DONE',
        result: { saved: 5 },
      });
    });

    it('records a failed job as FAILED with its error', async () => {
      const prisma = fakePrisma();
      const { service } = create(
        prisma,
        fakeJobs({ ok: false, error: 'supplier down' }),
      );
      prisma.rows.push({
        id: 'r1',
        sourceCode: 'dukon',
        jobName: 'process',
        params: null,
        status: 'PENDING',
        createdAt: new Date(),
      });

      await service.poll();
      await flush();

      expect(prisma.rows[0]).toMatchObject({
        status: 'FAILED',
        error: 'supplier down',
      });
    });

    it('never runs a request another worker already claimed', async () => {
      const prisma = fakePrisma();
      const jobs = fakeJobs();
      const { service } = create(prisma, jobs);
      prisma.rows.push({
        id: 'r1',
        sourceCode: 'dukon',
        jobName: 'process',
        params: null,
        status: 'PENDING',
        createdAt: new Date(),
      });
      // Another worker wins the conditional update between read and claim.
      prisma.parserJobRequest.updateMany.mockImplementationOnce(() =>
        Promise.resolve({ count: 0 }),
      );
      prisma.parserJobRequest.updateMany.mockImplementationOnce(() =>
        Promise.resolve({ count: 0 }),
      );

      await service.poll();
      await flush();

      expect(jobs.runRequested).not.toHaveBeenCalled();
    });
  });
});
