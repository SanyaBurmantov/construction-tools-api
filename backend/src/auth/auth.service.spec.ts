import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { CustomerType, UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';

type UserRow = {
  id: string;
  login: string;
  passwordHash: string;
  role: UserRole;
  customerType: CustomerType;
  isActive: boolean;
};

function buildService(options: { user?: UserRow | null } = {}) {
  const { user = null } = options;

  const sessionCreate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 's1', ...args.data }),
  );
  const userCreate = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'u1', ...args.data }),
  );
  const userUpdate = jest.fn(() => Promise.resolve({ id: 'u1' }));

  const userDelete = jest.fn(() => Promise.resolve({ id: 'u1' }));

  const prisma = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(user)),
      create: userCreate,
      update: userUpdate,
      delete: userDelete,
    },
    userSession: {
      create: sessionCreate,
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  } as unknown as PrismaService;

  return {
    service: new AuthService(prisma),
    prisma,
    userCreate,
    sessionCreate,
    userDelete,
  };
}

const baseRegistration = {
  login: 'Ivanov ',
  password: 'super-secret-1',
  customerType: CustomerType.INDIVIDUAL,
};

describe('AuthService.register', () => {
  it('stores the login normalized, hashed, and always as CUSTOMER', async () => {
    const { service, userCreate, sessionCreate } = buildService();

    const result = await service.register({
      ...baseRegistration,
      // A registration that asked for admin rights still gets CUSTOMER.
      name: ' Иван ',
      email: 'Ivan@Mail.BY',
    });

    const data = userCreate.mock.calls[0][0].data as Record<string, string>;
    expect(data.login).toBe('ivanov');
    expect(data.role).toBe(UserRole.CUSTOMER);
    expect(data.name).toBe('Иван');
    expect(data.email).toBe('ivan@mail.by');
    expect(data.passwordHash).not.toContain('super-secret-1');
    expect(data.passwordHash.startsWith('scrypt$')).toBe(true);

    // The session token is returned to the client, its hash is what is stored.
    const session = sessionCreate.mock.calls[0][0].data as Record<
      string,
      string
    >;
    expect(result.token).toBeTruthy();
    expect(session.tokenHash).toBe(AuthService.hashToken(result.token));
    expect(session.tokenHash).not.toBe(result.token);
  });

  it('refuses a taken login', async () => {
    const { service } = buildService({
      user: {
        id: 'u0',
        login: 'ivanov',
        passwordHash: 'x',
        role: UserRole.CUSTOMER,
        customerType: CustomerType.INDIVIDUAL,
        isActive: true,
      },
    });
    await expect(service.register(baseRegistration)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires a company name for a legal entity', async () => {
    const { service } = buildService();
    await expect(
      service.register({
        ...baseRegistration,
        customerType: CustomerType.COMPANY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a legal entity that gave its name', async () => {
    const { service, userCreate } = buildService();
    await service.register({
      ...baseRegistration,
      customerType: CustomerType.COMPANY,
      companyName: 'ООО Ромашка',
      taxId: '123456789',
    });
    const data = userCreate.mock.calls[0][0].data as Record<string, string>;
    expect(data.customerType).toBe(CustomerType.COMPANY);
    expect(data.companyName).toBe('ООО Ромашка');
  });

  it('rejects a short password before touching the database', async () => {
    const { service, userCreate } = buildService();
    await expect(
      service.register({ ...baseRegistration, password: 'short' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  async function activeUser(
    overrides: Partial<UserRow> = {},
  ): Promise<UserRow> {
    return {
      id: 'u1',
      login: 'ivanov',
      passwordHash: await hashPassword('super-secret-1'),
      role: UserRole.CUSTOMER,
      customerType: CustomerType.INDIVIDUAL,
      isActive: true,
      ...overrides,
    };
  }

  it('issues a session for the right password', async () => {
    const { service, sessionCreate } = buildService({
      user: await activeUser(),
    });
    const result = await service.login({
      login: 'IVANOV',
      password: 'super-secret-1',
    });
    expect(result.token).toBeTruthy();
    expect(sessionCreate).toHaveBeenCalled();
  });

  it('rejects a wrong password without saying which half was wrong', async () => {
    const { service } = buildService({ user: await activeUser() });
    await expect(
      service.login({ login: 'ivanov', password: 'wrong-password' }),
    ).rejects.toThrow('Неверный логин или пароль');
  });

  it('gives an unknown login the same message', async () => {
    const { service } = buildService({ user: null });
    await expect(
      service.login({ login: 'nobody', password: 'super-secret-1' }),
    ).rejects.toThrow('Неверный логин или пароль');
  });

  it('refuses a deactivated account that knows its password', async () => {
    const { service } = buildService({
      user: await activeUser({ isActive: false }),
    });
    await expect(
      service.login({ login: 'ivanov', password: 'super-secret-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.resolveSession', () => {
  function withSession(session: unknown) {
    const deleteMock = jest.fn(() => Promise.resolve({}));
    const prisma = {
      userSession: {
        findUnique: jest.fn(() => Promise.resolve(session)),
        delete: deleteMock,
        update: jest.fn(() => Promise.resolve({})),
      },
    } as unknown as PrismaService;
    return { service: new AuthService(prisma), deleteMock };
  }

  const user = {
    id: 'u1',
    login: 'ivanov',
    role: UserRole.ADMIN,
    customerType: CustomerType.INDIVIDUAL,
    isActive: true,
  };

  it('resolves a live session', async () => {
    const { service } = withSession({
      id: 's1',
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(),
      user,
    });
    await expect(service.resolveSession('token')).resolves.toEqual({
      user,
      sessionId: 's1',
    });
  });

  it('drops an expired session instead of honouring it', async () => {
    const { service, deleteMock } = withSession({
      id: 's1',
      expiresAt: new Date(Date.now() - 1),
      lastSeenAt: new Date(),
      user,
    });
    await expect(service.resolveSession('token')).resolves.toBeNull();
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('refuses a session whose account was deactivated', async () => {
    const { service } = withSession({
      id: 's1',
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(),
      user: { ...user, isActive: false },
    });
    await expect(service.resolveSession('token')).resolves.toBeNull();
  });

  it('returns null for an unknown token', async () => {
    const { service } = withSession(null);
    await expect(service.resolveSession('token')).resolves.toBeNull();
    await expect(service.resolveSession('')).resolves.toBeNull();
  });
});

describe('AuthService.deleteOwnAccount', () => {
  async function account(overrides: Partial<UserRow> = {}): Promise<UserRow> {
    return {
      id: 'u1',
      login: 'ivanov',
      passwordHash: await hashPassword('super-secret-1'),
      role: UserRole.CUSTOMER,
      customerType: CustomerType.INDIVIDUAL,
      isActive: true,
      ...overrides,
    };
  }

  it('deletes the account once the password checks out', async () => {
    const { service, userDelete } = buildService({ user: await account() });

    await expect(
      service.deleteOwnAccount('u1', { password: 'super-secret-1' }),
    ).resolves.toEqual({ ok: true });
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  // A session can be a borrowed laptop; the password is the confirmation.
  it('refuses a wrong password', async () => {
    const { service, userDelete } = buildService({ user: await account() });

    await expect(
      service.deleteOwnAccount('u1', { password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userDelete).not.toHaveBeenCalled();
  });

  /**
   * Letting an admin close its own account from the storefront form is a way
   * to lock everyone out by accident — /admin/users owns that decision.
   */
  it('refuses to close an administrator account', async () => {
    const { service, userDelete } = buildService({
      user: await account({ role: UserRole.ADMIN }),
    });

    await expect(
      service.deleteOwnAccount('u1', { password: 'super-secret-1' }),
    ).rejects.toThrow('администратора');
    expect(userDelete).not.toHaveBeenCalled();
  });
});
