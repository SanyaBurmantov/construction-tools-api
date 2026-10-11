import { ErrorLogService, type ErrorEntry } from './error-log.service';
import { PrismaService } from '../prisma/prisma.service';

function buildService() {
  const create = jest.fn(() => Promise.resolve({ id: 'row-1' }));
  const update = jest.fn(() => Promise.resolve({}));
  const prisma = {
    errorLog: { create, update },
  } as unknown as PrismaService;
  return { service: new ErrorLogService(prisma), create, update };
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
      new ErrorLogService(prisma).record(entry()),
    ).resolves.toBeUndefined();
  });
});
