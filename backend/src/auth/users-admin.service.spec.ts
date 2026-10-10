import { BadRequestException } from '@nestjs/common';
import { CustomerType, UserRole } from '@prisma/client';
import { UsersAdminService } from './users-admin.service';
import { PrismaService } from '../prisma/prisma.service';

function buildService(
  options: {
    user?: {
      id: string;
      role: UserRole;
      isActive: boolean;
      customerType?: CustomerType;
      companyName?: string | null;
    } | null;
    otherActiveAdmins?: number;
  } = {},
) {
  const {
    user = {
      id: 'u1',
      role: UserRole.ADMIN,
      isActive: true,
      customerType: CustomerType.INDIVIDUAL,
      companyName: null,
    },
    otherActiveAdmins = 1,
  } = options;

  const update = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'u1', ...args.data }),
  );
  const create = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'new', ...args.data }),
  );
  const sessionDeleteMany = jest.fn(() => Promise.resolve({ count: 2 }));

  const prisma = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(user)),
      count: jest.fn(() => Promise.resolve(otherActiveAdmins)),
      create,
      update,
      delete: jest.fn(() => Promise.resolve({})),
    },
    userSession: { deleteMany: sessionDeleteMany },
  } as unknown as PrismaService;

  return {
    service: new UsersAdminService(prisma),
    update,
    create,
    sessionDeleteMany,
  };
}

describe('UsersAdminService.create', () => {
  it('creates an admin account with a hashed password', async () => {
    const { service, create } = buildService({ user: null });
    await service.create({
      login: 'Manager ',
      password: 'super-secret-1',
      role: UserRole.ADMIN,
    });
    const data = create.mock.calls[0][0].data as Record<string, string>;
    expect(data.login).toBe('manager');
    expect(data.role).toBe(UserRole.ADMIN);
    expect(data.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('defaults to a customer account', async () => {
    const { service, create } = buildService({ user: null });
    await service.create({ login: 'client', password: 'super-secret-1' });
    const data = create.mock.calls[0][0].data as Record<string, string>;
    expect(data.role).toBe(UserRole.CUSTOMER);
  });

  it('rejects a weak password', async () => {
    const { service, create } = buildService({ user: null });
    await expect(
      service.create({ login: 'client', password: '123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('UsersAdminService.update', () => {
  it('refuses to demote the acting admin', async () => {
    const { service } = buildService();
    await expect(
      service.update('u1', { role: UserRole.CUSTOMER }, 'u1'),
    ).rejects.toThrow('собственной учётной записи');
  });

  it('refuses to demote the last active admin', async () => {
    const { service } = buildService({ otherActiveAdmins: 0 });
    await expect(
      service.update('u1', { role: UserRole.CUSTOMER }, 'another-admin'),
    ).rejects.toThrow('последний активный администратор');
  });

  it('refuses to deactivate the last active admin', async () => {
    const { service } = buildService({ otherActiveAdmins: 0 });
    await expect(
      service.update('u1', { isActive: false }, 'another-admin'),
    ).rejects.toThrow('последний активный администратор');
  });

  it('allows the demotion once another admin exists', async () => {
    const { service, update } = buildService({ otherActiveAdmins: 2 });
    await service.update('u1', { role: UserRole.CUSTOMER }, 'another-admin');
    expect(update).toHaveBeenCalled();
  });

  it('drops every session when the password is reset', async () => {
    const { service, sessionDeleteMany } = buildService({
      user: { id: 'u2', role: UserRole.CUSTOMER, isActive: true },
    });
    await service.update('u2', { password: 'new-super-secret' }, 'admin');
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'u2' },
    });
  });

  it('drops every session when the account is disabled', async () => {
    const { service, sessionDeleteMany } = buildService({
      user: { id: 'u2', role: UserRole.CUSTOMER, isActive: true },
    });
    await service.update('u2', { isActive: false }, 'admin');
    expect(sessionDeleteMany).toHaveBeenCalled();
  });

  it('requires a company name when switching to a legal entity', async () => {
    const { service } = buildService({
      user: {
        id: 'u2',
        role: UserRole.CUSTOMER,
        isActive: true,
        customerType: CustomerType.INDIVIDUAL,
        companyName: null,
      },
    });
    await expect(
      service.update('u2', { customerType: CustomerType.COMPANY }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UsersAdminService.remove', () => {
  it('refuses to delete the acting admin', async () => {
    const { service } = buildService();
    await expect(service.remove('u1', 'u1')).rejects.toThrow(
      'собственную учётную запись',
    );
  });

  it('refuses to delete the last active admin', async () => {
    const { service } = buildService({ otherActiveAdmins: 0 });
    await expect(service.remove('u1', 'another-admin')).rejects.toThrow(
      'последний активный администратор',
    );
  });

  it('deletes a customer account', async () => {
    const { service } = buildService({
      user: { id: 'u2', role: UserRole.CUSTOMER, isActive: true },
    });
    await expect(service.remove('u2', 'admin')).resolves.toEqual({ ok: true });
  });
});
