import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerType, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requisitesData } from './company-requisites';
import {
  AdminCreateUserDto,
  AdminUpdateUserDto,
  AdminUserQueryDto,
} from './dto/admin-user.dto';
import { USER_SELECT } from './auth.service';
import { loginProblem, normalizeLogin } from './login.util';
import { hashPassword, passwordProblem } from './password.util';
import { isUniqueViolation } from './prisma-errors';

const DEFAULT_LIMIT = 50;

/** Orders an admin counts as "в работе" for a customer. */
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
];

/** Cancelled orders are history, not money spent. */
const SPENT_ORDER_STATUSES: OrderStatus[] = [
  ...ACTIVE_ORDER_STATUSES,
  OrderStatus.DELIVERED,
];

/**
 * Account management for the admin panel — including creating other admins,
 * which is the only way an ADMIN account comes into existence (registration
 * always produces a CUSTOMER).
 */
/** pg_advisory_xact_lock key for the last-admin guard (any fixed int8). */
const ADMIN_GUARD_LOCK_KEY = 4_200_001;

@Injectable()
export class UsersAdminService {
  constructor(private prisma: PrismaService) {}

  async list(query: AdminUserQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: Prisma.UserWhereInput = {};

    if (query.role) where.role = query.role;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { login: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search.replace(/\s/g, '') } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { ...USER_SELECT, _count: { select: { sessions: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * One account with everything an admin needs on its card: the profile, the
   * figures, and the full order history — current orders first, since that is
   * what someone opening this page is usually chasing.
   */
  async getOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...USER_SELECT, _count: { select: { sessions: true } } },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    const [orders, spent, counts] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      this.prisma.order.aggregate({
        where: { userId: id, status: { in: SPENT_ORDER_STATUSES } },
        _sum: { total: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { userId: id },
        _count: { _all: true },
      }),
    ]);

    const byStatus = Object.fromEntries(
      counts.map((row) => [row.status, row._count._all]),
    ) as Partial<Record<OrderStatus, number>>;

    return {
      user,
      orders,
      stats: {
        total: orders.length,
        active: ACTIVE_ORDER_STATUSES.reduce(
          (sum, status) => sum + (byStatus[status] ?? 0),
          0,
        ),
        byStatus,
        // Floating-point sums of 2-decimal prices drift; round once here.
        totalSpent: Math.round((spent._sum.total ?? 0) * 100) / 100,
      },
    };
  }

  async create(dto: AdminCreateUserDto) {
    const problem = loginProblem(dto.login) ?? passwordProblem(dto.password);
    if (problem) throw new BadRequestException(problem);

    const login = normalizeLogin(dto.login);
    const customerType = dto.customerType ?? CustomerType.INDIVIDUAL;
    if (customerType === CustomerType.COMPANY && !dto.companyName?.trim())
      throw new BadRequestException(
        'Для юридического лица укажите название организации',
      );

    const existing = await this.prisma.user.findUnique({
      where: { login },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Этот логин уже занят');

    try {
      return await this.prisma.user.create({
        data: {
          login,
          passwordHash: await hashPassword(dto.password),
          role: dto.role ?? UserRole.CUSTOMER,
          customerType,
          name: dto.name?.trim() || null,
          email: dto.email?.trim().toLowerCase() || null,
          phone: dto.phone?.trim() || null,
          companyName: dto.companyName?.trim() || null,
          ...requisitesData(dto),
        },
        select: USER_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Этот логин уже занят');
      throw error;
    }
  }

  /** Active admins other than `exceptId` — the last-admin guard reads this. */
  private async otherActiveAdmins(
    exceptId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    return db.user.count({
      where: { role: UserRole.ADMIN, isActive: true, NOT: { id: exceptId } },
    });
  }

  /**
   * Runs a change that may remove an admin under one transaction-scoped
   * advisory lock. The last-admin guard is check-then-act: without the lock,
   * two admins demoting each other at the same moment each see one other
   * admin, both commit, and nobody can sign in any more.
   */
  private withAdminLock<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK_KEY})`;
      return fn(tx);
    });
  }

  /**
   * `actorId` is the admin performing the change, or undefined when the call
   * came in with the `x-admin-token` service header. Two things are refused
   * whatever the caller: locking yourself out, and removing the last way in.
   */
  async update(
    id: string,
    dto: AdminUpdateUserDto,
    actorId?: string,
    actorSessionId?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');

    const losesAdmin =
      user.role === UserRole.ADMIN &&
      ((dto.role !== undefined && dto.role !== UserRole.ADMIN) ||
        dto.isActive === false);

    if (losesAdmin && actorId === id)
      throw new BadRequestException(
        'Нельзя снять права администратора с собственной учётной записи',
      );

    const customerType = dto.customerType ?? user.customerType;
    const companyName =
      dto.companyName === undefined ? user.companyName : dto.companyName;
    if (customerType === CustomerType.COMPANY && !companyName?.trim())
      throw new BadRequestException(
        'Для юридического лица укажите название организации',
      );

    const email =
      dto.email === undefined
        ? undefined
        : dto.email?.trim().toLowerCase() || null;
    const data: Prisma.UserUpdateInput = {
      role: dto.role,
      isActive: dto.isActive,
      customerType: dto.customerType,
      // `?.`: an explicit null clears the field instead of throwing a 500.
      name: dto.name === undefined ? undefined : dto.name?.trim() || null,
      email,
      // A new address is unproven, same rule as a customer's own change.
      emailVerifiedAt:
        email !== undefined && email !== user.email ? null : undefined,
      phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
      companyName:
        dto.companyName === undefined
          ? undefined
          : dto.companyName?.trim() || null,
      ...requisitesData(dto),
    };

    if (dto.password) {
      const problem = passwordProblem(dto.password);
      if (problem) throw new BadRequestException(problem);
      data.passwordHash = await hashPassword(dto.password);
    }

    const write = async (tx: Prisma.TransactionClient) => {
      if (losesAdmin && (await this.otherActiveAdmins(id, tx)) === 0)
        throw new BadRequestException(
          'Это последний активный администратор — сначала создайте другого',
        );
      const updated = await tx.user.update({
        where: { id },
        data,
        select: USER_SELECT,
      });

      // A reset password or a disabled account must take effect now, not
      // whenever the open session happens to expire. An admin resetting
      // their own password keeps the session they are using, like
      // AuthService.changePassword does.
      if (dto.password || dto.isActive === false) {
        await tx.userSession.deleteMany({
          where: {
            userId: id,
            ...(actorId === id && actorSessionId
              ? { NOT: { id: actorSessionId } }
              : {}),
          },
        });
      }
      return updated;
    };

    return losesAdmin
      ? this.withAdminLock(write)
      : this.prisma.$transaction(write);
  }

  async remove(id: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (actorId === id)
      throw new BadRequestException(
        'Нельзя удалить собственную учётную запись',
      );
    // Sessions cascade with the row.
    if (user.role === UserRole.ADMIN && user.isActive) {
      await this.withAdminLock(async (tx) => {
        if ((await this.otherActiveAdmins(id, tx)) === 0)
          throw new BadRequestException(
            'Это последний активный администратор — сначала создайте другого',
          );
        await tx.user.delete({ where: { id } });
      });
    } else {
      await this.prisma.user.delete({ where: { id } });
    }
    return { ok: true };
  }
}
