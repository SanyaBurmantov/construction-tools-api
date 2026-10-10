import { UserRole } from '@prisma/client';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password.util';

function buildService(
  options: {
    activeAdmins?: number;
    /** An account already holding the login the bootstrap wants. */
    taken?: { id: string; role: UserRole; isActive: boolean } | null;
  } = {},
) {
  const { activeAdmins = 0, taken = null } = options;

  const created: Array<{
    login: string;
    passwordHash: string;
    role: UserRole;
  }> = [];
  const create = jest.fn(
    (args: {
      data: { login: string; passwordHash: string; role: UserRole };
    }) => {
      created.push(args.data);
      return Promise.resolve({ id: 'u1', ...args.data });
    },
  );

  const prisma = {
    user: {
      count: jest.fn(() => Promise.resolve(activeAdmins)),
      findUnique: jest.fn(() => Promise.resolve(taken)),
      create,
    },
  } as unknown as PrismaService;

  return { service: new AdminBootstrapService(prisma), created };
}

describe('AdminBootstrapService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ADMIN_LOGIN;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /**
   * The contract everyone relies on to get in the first time: `admin` /
   * `test-111`, with nothing configured at all.
   */
  it('creates admin / test-111 when nothing is configured', async () => {
    const { service, created } = buildService();

    await service.onModuleInit();

    expect(created).toHaveLength(1);
    expect(created[0].login).toBe('admin');
    expect(created[0].role).toBe(UserRole.ADMIN);
    await expect(
      verifyPassword('test-111', created[0].passwordHash),
    ).resolves.toBe(true);
  });

  it('uses ADMIN_PASSWORD when it is set', async () => {
    process.env.ADMIN_PASSWORD = 'chosen-by-the-operator';
    const { service, created } = buildService();

    await service.onModuleInit();

    await expect(
      verifyPassword('chosen-by-the-operator', created[0].passwordHash),
    ).resolves.toBe(true);
    await expect(
      verifyPassword('test-111', created[0].passwordHash),
    ).resolves.toBe(false);
  });

  // ADMIN_TOKEN is the service header, not a password: keeping it as a
  // fallback made the first login differ per deployment.
  it('ignores ADMIN_TOKEN as a password', async () => {
    process.env.ADMIN_TOKEN = 'long-random-service-token';
    const { service, created } = buildService();

    await service.onModuleInit();

    await expect(
      verifyPassword('test-111', created[0].passwordHash),
    ).resolves.toBe(true);
  });

  it('honours ADMIN_LOGIN and normalizes it', async () => {
    process.env.ADMIN_LOGIN = '  Manager ';
    const { service, created } = buildService();

    await service.onModuleInit();

    expect(created[0].login).toBe('manager');
  });

  // The whole point of the "no active admin" check: a password someone changed
  // must not be reset back to the committed one on the next restart.
  it('does nothing when an active admin already exists', async () => {
    const { service, created } = buildService({ activeAdmins: 1 });

    await service.onModuleInit();

    expect(created).toEqual([]);
  });

  it('refuses to take over a login that belongs to someone else', async () => {
    const { service, created } = buildService({
      taken: { id: 'u9', role: UserRole.CUSTOMER, isActive: true },
    });

    await service.onModuleInit();

    expect(created).toEqual([]);
  });

  // A failed bootstrap must never stop the API from starting.
  it('swallows a database failure', async () => {
    const prisma = {
      user: {
        count: jest.fn(() => Promise.reject(new Error('db is down'))),
      },
    } as unknown as PrismaService;

    await expect(
      new AdminBootstrapService(prisma).onModuleInit(),
    ).resolves.toBeUndefined();
  });
});
