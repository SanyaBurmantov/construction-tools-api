import { AdminActionLogService } from './admin-action-log.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminActionLogService.redact', () => {
  it('replaces anything that looks like a secret', () => {
    const redacted = AdminActionLogService.redact({
      login: 'manager',
      password: 'super-secret-1',
      nested: { adminToken: 'abc', authorization: 'Bearer x' },
    }) as Record<string, unknown>;

    expect(redacted.login).toBe('manager');
    expect(redacted.password).toBe('[redacted]');
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.adminToken).toBe('[redacted]');
    expect(nested.authorization).toBe('[redacted]');
  });

  it('keeps ordinary values, including falsy ones', () => {
    const redacted = AdminActionLogService.redact({
      isActive: false,
      price: 0,
      note: null,
    });
    expect(redacted).toEqual({ isActive: false, price: 0, note: null });
  });

  it('summarises a long array instead of copying it', () => {
    const redacted = AdminActionLogService.redact(
      Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` })),
    ) as unknown[];

    expect(redacted).toHaveLength(21);
    expect(redacted[20]).toBe('[+30 more]');
  });

  it('stops descending at a sane depth', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 10; i += 1) deep = { next: deep };
    const serialized = JSON.stringify(AdminActionLogService.redact(deep));
    expect(serialized).toContain('[deep]');
  });
});

describe('AdminActionLogService.preparePayload', () => {
  it('skips an empty body', () => {
    expect(AdminActionLogService.preparePayload({})).toBeUndefined();
    expect(AdminActionLogService.preparePayload(undefined)).toBeUndefined();
    expect(AdminActionLogService.preparePayload(null)).toBeUndefined();
  });

  it('truncates a body that is too large to keep whole', () => {
    const payload = AdminActionLogService.preparePayload({
      description: 'x'.repeat(10_000),
    }) as { truncated?: boolean; preview?: string };

    expect(payload.truncated).toBe(true);
    expect(payload.preview?.length).toBe(4000);
  });

  it('never lets a password through, even truncated', () => {
    const payload = AdminActionLogService.preparePayload({
      password: 'super-secret-1',
      filler: 'y'.repeat(10_000),
    });
    expect(JSON.stringify(payload)).not.toContain('super-secret-1');
  });
});

describe('AdminActionLogService.record', () => {
  function buildService(options: { fail?: boolean } = {}) {
    // Recorded rather than read off `mock.calls`, so the assertion needs no
    // cast and the callback parameter is genuinely used.
    const written: Array<Record<string, unknown>> = [];
    const create = jest.fn((args: { data: Record<string, unknown> }) => {
      if (options.fail) return Promise.reject(new Error('db down'));
      written.push(args.data);
      return Promise.resolve(args.data);
    });
    const prisma = {
      adminActionLog: { create },
    } as unknown as PrismaService;
    return { service: new AdminActionLogService(prisma), written };
  }

  it('stores the actor, route and outcome', async () => {
    const { service, written } = buildService();

    await service.record({
      actorId: 'u1',
      actorLabel: 'admin',
      method: 'PATCH',
      path: '/admin/users/u2',
      statusCode: 200,
      payload: { role: 'ADMIN' },
      ip: '10.0.0.1',
      durationMs: 42,
    });

    expect(written[0]).toMatchObject({
      actorId: 'u1',
      actorLabel: 'admin',
      method: 'PATCH',
      path: '/admin/users/u2',
      statusCode: 200,
      ip: '10.0.0.1',
      durationMs: 42,
    });
  });

  // An audit write must never turn a successful admin action into an error.
  it('swallows a failed write', async () => {
    const { service } = buildService({ fail: true });
    await expect(
      service.record({
        actorLabel: 'x-admin-token',
        method: 'POST',
        path: '/admin/queue/process',
        statusCode: 201,
      }),
    ).resolves.toBeUndefined();
  });
});
