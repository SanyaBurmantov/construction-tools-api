import { ErrorLogService, type ErrorEntry } from './error-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';

const silentTelegram = () =>
  ({
    notifyServerError: jest.fn(() => Promise.resolve(true)),
  }) as unknown as TelegramService & { notifyServerError: jest.Mock };

type CreateArgs = { data: Record<string, unknown> };

function buildService(telegram = silentTelegram()) {
  // Typed arguments, so the assertions below can read `mock.calls[0][0].data`
  // instead of casting at every use.
  const create = jest.fn((_args: CreateArgs) =>
    Promise.resolve({ id: 'row-1' }),
  );
  const update = jest.fn((_args: unknown) => Promise.resolve({}));
  const prisma = {
    errorLog: { create, update },
  } as unknown as PrismaService;
  return {
    service: new ErrorLogService(prisma, telegram),
    create,
    update,
    telegram,
  };
}

const entry = (overrides: Partial<ErrorEntry> = {}): ErrorEntry => ({
  statusCode: 500,
  method: 'POST',
  path: '/orders',
  kind: 'Error',
  message: 'boom',
  ...overrides,
});

describe('ErrorLogService.record', () => {
  it('writes at most 30 rejected admin attempts per address per hour', async () => {
    const { service, create } = buildService();
    for (let i = 0; i < 40; i++) {
      // A different message each time, so the dedupe window cannot fold them.
      await service.record(
        entry({
          statusCode: 401,
          method: 'GET',
          path: '/admin/x',
          message: `m${i}`,
          ip: '1.2.3.4',
        }),
      );
    }
    await service.record(
      entry({
        statusCode: 401,
        method: 'GET',
        path: '/admin/x',
        message: 'other',
        ip: '5.6.7.8',
      }),
    );
    expect(create).toHaveBeenCalledTimes(31);
  });

  it('writes the failure', async () => {
    const { service, create } = buildService();
    await service.record(entry());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusCode: 500,
          method: 'POST',
          path: '/orders',
          message: 'boom',
        }) as unknown,
      }),
    );
  });

  /**
   * One broken endpoint under load fails on every request. At a row per
   * request the log becomes the incident, so a repeat of the same failure
   * bumps the row it already wrote — the count is kept, the writes are not.
   */
  it('folds a repeat of the same failure into the row it already wrote', async () => {
    const { service, create, update } = buildService();
    await service.record(entry());
    await service.record(entry());
    await service.record(entry());

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'row-1' },
        data: expect.objectContaining({
          occurrences: { increment: 1 },
        }) as unknown,
      }),
    );
  });

  it('keeps a different failure apart', async () => {
    const { service, create } = buildService();
    await service.record(entry());
    await service.record(entry({ message: 'other' }));
    await service.record(entry({ path: '/cart' }));

    expect(create).toHaveBeenCalledTimes(3);
  });

  // The same rule as the audit trail: a password must never land in a table
  // an admin can read.
  it('redacts secrets out of the request body', async () => {
    const { service, create } = buildService();
    await service.record(
      entry({ payload: { login: 'admin', password: 'test-111' } }),
    );

    const data = create.mock.calls[0][0] as unknown as {
      data: { payload: { login: string; password: string } };
    };
    expect(data.data.payload).toEqual({
      login: 'admin',
      password: '[redacted]',
    });
  });

  it('keeps a stack for a server error only', async () => {
    const { service, create } = buildService();
    await service.record(entry({ stack: 'at somewhere' }));

    const data = create.mock.calls[0][0] as unknown as {
      data: { stack: string | null };
    };
    expect(data.data.stack).toBe('at somewhere');
  });

  /**
   * This runs from the exception filter, where the request has already failed.
   * Failing to log the failure must not replace the response the caller was
   * about to get.
   */
  it('swallows its own write failure', async () => {
    const prisma = {
      errorLog: {
        create: jest.fn(() => Promise.reject(new Error('db down'))),
        update: jest.fn(),
      },
    } as unknown as PrismaService;

    await expect(
      new ErrorLogService(prisma, silentTelegram()).record(entry()),
    ).resolves.toBeUndefined();
  });
});

describe('ErrorLogService Telegram alerts', () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('alerts on a new 5xx, not on a 4xx', async () => {
    const { service, telegram } = buildService();
    await service.record(entry({ statusCode: 400, message: 'bad input' }));
    expect(telegram.notifyServerError).not.toHaveBeenCalled();
    await service.record(entry());
    expect(telegram.notifyServerError).toHaveBeenCalledTimes(1);
  });

  it('sends the same failure once an hour', async () => {
    const { service, telegram } = buildService();
    await service.record(entry());
    now += 2 * 60_000; // past the 60 s row dedupe, inside the alert hour
    await service.record(entry());
    expect(telegram.notifyServerError).toHaveBeenCalledTimes(1);
    now += 60 * 60_000;
    await service.record(entry());
    expect(telegram.notifyServerError).toHaveBeenCalledTimes(2);
  });

  it('caps distinct alerts per hour', async () => {
    const { service, telegram } = buildService();
    for (let i = 0; i < 25; i++) {
      await service.record(entry({ message: `boom ${i}` }));
    }
    expect(telegram.notifyServerError).toHaveBeenCalledTimes(10);
  });

  it('never fails the log write when Telegram rejects', async () => {
    const telegram = silentTelegram();
    telegram.notifyServerError.mockRejectedValue(new Error('down'));
    const { service, create } = buildService(telegram);
    await expect(service.record(entry())).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
