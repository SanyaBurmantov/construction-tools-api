import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CustomerType, Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashOpaqueToken } from './token-hash';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateProfileDto,
} from './dto/update-profile.dto';
import { loginProblem, normalizeLogin } from './login.util';
import { isUniqueViolation } from './prisma-errors';
import {
  dummyPasswordHash,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './password.util';
import { EmailVerificationService } from './email-verification.service';

/** Fields safe to return — `passwordHash` is never selected. */
export const USER_SELECT = {
  id: true,
  login: true,
  role: true,
  customerType: true,
  name: true,
  email: true,
  emailVerifiedAt: true,
  phone: true,
  companyName: true,
  taxId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export type AuthenticatedUser = Pick<
  User,
  'id' | 'login' | 'role' | 'customerType' | 'isActive'
>;

export type SessionContext = {
  user: AuthenticatedUser;
  sessionId: string;
};

const DEFAULT_TTL_DAYS = 30;
/** Loose on purpose — `@IsEmail()` already guards the e-mail field itself. */
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** How stale `lastSeenAt` may get before a request refreshes it. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private emailVerification: EmailVerificationService,
  ) {}

  private ttlMs(): number {
    const days = Number(process.env.AUTH_SESSION_TTL_DAYS);
    return (
      (Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS) *
      24 *
      60 *
      60 *
      1000
    );
  }

  /**
   * Only the hash of a session token is stored, so a leaked dump cannot be
   * replayed as a login. Unsalted on purpose: the token is 256 bits of
   * randomness, which a rainbow table cannot cover.
   */
  static hashToken(token: string): string {
    return hashOpaqueToken(token);
  }

  /** The company-name rule lives here so register and admin-create share it. */
  private assertCompanyComplete(
    customerType: CustomerType | undefined,
    companyName: string | null | undefined,
  ) {
    if (customerType === CustomerType.COMPANY && !companyName?.trim()) {
      throw new BadRequestException(
        'Для юридического лица укажите название организации',
      );
    }
  }

  private async issueSession(userId: string, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs());
    await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: AuthService.hashToken(token),
        userAgent: userAgent?.slice(0, 300),
        expiresAt,
      },
    });
    return { token, expiresAt };
  }

  /** Normalizes and validates a login, or throws with a readable reason. */
  private cleanLogin(login: string): string {
    const problem = loginProblem(login);
    if (problem) throw new BadRequestException(problem);
    return normalizeLogin(login);
  }

  private async createUser(data: Prisma.UserCreateInput): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({ data, select: USER_SELECT });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Этот логин уже занят');
      throw error;
    }
  }

  async register(dto: RegisterDto, userAgent?: string) {
    const login = this.cleanLogin(dto.login);
    const passwordIssue = passwordProblem(dto.password);
    if (passwordIssue) throw new BadRequestException(passwordIssue);
    this.assertCompanyComplete(dto.customerType, dto.companyName);
    // The confirmation letter needs an address: the e-mail field, or the
    // login itself when that is an e-mail.
    const email =
      dto.email?.trim().toLowerCase() ||
      (EMAIL_LIKE.test(login) ? login : null);
    if (!email)
      throw new BadRequestException(
        'Укажите e-mail — на него придёт письмо для подтверждения регистрации',
      );

    const existing = await this.prisma.user.findUnique({
      where: { login },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Этот логин уже занят');

    const user = await this.createUser({
      login,
      passwordHash: await hashPassword(dto.password),
      // Registration can never mint an admin — admins are created in the
      // admin panel by another admin.
      role: UserRole.CUSTOMER,
      customerType: dto.customerType,
      name: dto.name?.trim() || null,
      email,
      phone: dto.phone?.trim() || null,
      companyName: dto.companyName?.trim() || null,
      taxId: dto.taxId?.trim() || null,
      lastLoginAt: new Date(),
    });

    const session = await this.issueSession(user.id, userAgent);
    // Not awaited: SMTP latency must not hold the sign-up, and `issue()`
    // never rejects — a lost letter is re-requested from the account page.
    void this.emailVerification.issue(user, email);
    return { ...session, user };
  }

  async login(dto: LoginDto, userAgent?: string) {
    const login = normalizeLogin(dto.login);
    const user = await this.prisma.user.findUnique({ where: { login } });

    // One message for "no such login" and "wrong password": telling them apart
    // turns the login form into a list of registered accounts.
    const invalid = new UnauthorizedException('Неверный логин или пароль');
    if (!user) {
      // Spend the same scrypt time as a real check, or the response time
      // tells an unknown login from a wrong password.
      await verifyPassword(dto.password, await dummyPasswordHash());
      throw invalid;
    }
    if (!(await verifyPassword(dto.password, user.passwordHash))) throw invalid;
    if (!user.isActive)
      throw new UnauthorizedException('Учётная запись отключена');

    const session = await this.issueSession(user.id, userAgent);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: USER_SELECT,
    });
    return { ...session, user: updated };
  }

  async logout(token: string) {
    await this.prisma.userSession.deleteMany({
      where: { tokenHash: AuthService.hashToken(token) },
    });
    return { ok: true };
  }

  /**
   * Logs the account out on every device. Offered in the account settings and
   * the honest answer to "I think someone else has my password" — it is also
   * what a password change does implicitly.
   */
  async logoutEverywhere(userId: string) {
    const { count } = await this.prisma.userSession.deleteMany({
      where: { userId },
    });
    return { ok: true, sessions: count };
  }

  /**
   * Resolves a bearer token to its account, or null for anything unusable —
   * unknown, expired or belonging to a deactivated user. Expired rows are
   * deleted on sight so the table does not grow forever even without the cron.
   */
  async resolveSession(token: string): Promise<SessionContext | null> {
    if (!token) return null;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: AuthService.hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        lastSeenAt: true,
        user: {
          select: {
            id: true,
            login: true,
            role: true,
            customerType: true,
            isActive: true,
          },
        },
      },
    });
    if (!session) return null;

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.userSession
        .delete({ where: { id: session.id } })
        .catch(() => undefined);
      return null;
    }
    if (!session.user.isActive) return null;

    // Fire-and-forget bookkeeping, throttled so an active session does not
    // cost a write per request — and a failed write never fails the request.
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      void this.prisma.userSession
        .update({
          where: { id: session.id },
          data: { lastSeenAt: new Date() },
        })
        .catch(() => undefined);
    }

    return { user: session.user, sessionId: session.id };
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new UnauthorizedException('Учётная запись не найдена');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const current = await this.getProfile(userId);
    const customerType = dto.customerType ?? current.customerType;
    const companyName =
      dto.companyName === undefined ? current.companyName : dto.companyName;
    this.assertCompanyComplete(customerType, companyName);

    const email =
      dto.email === undefined
        ? undefined
        : dto.email?.trim().toLowerCase() || null;
    // A new address is unproven until its own link is followed.
    const emailChanged = email !== undefined && email !== current.email;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        customerType,
        // `null` clears a field (form-values.ts convention) — `?.` keeps it
        // from becoming a 500.
        name: dto.name === undefined ? undefined : dto.name?.trim() || null,
        email,
        emailVerifiedAt: emailChanged ? null : undefined,
        phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
        companyName:
          dto.companyName === undefined
            ? undefined
            : dto.companyName?.trim() || null,
        taxId: dto.taxId === undefined ? undefined : dto.taxId?.trim() || null,
      },
      select: USER_SELECT,
    });
    if (emailChanged && updated.email)
      void this.emailVerification.issue(updated, updated.email);
    return updated;
  }

  /**
   * Changing the password logs every other device out: if the reason for the
   * change is that someone else knew the old one, leaving their session alive
   * would defeat the point.
   */
  async changePassword(
    userId: string,
    sessionId: string,
    dto: ChangePasswordDto,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Учётная запись не найдена');
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash)))
      throw new BadRequestException('Текущий пароль указан неверно');

    const problem = passwordProblem(dto.newPassword);
    if (problem) throw new BadRequestException(problem);

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.userSession.deleteMany({
        where: { userId, NOT: { id: sessionId } },
      }),
    ]);
    return { ok: true };
  }

  /**
   * Account closure by its owner. Requires the password, then deletes the row:
   * sessions, the stored cart and the stored lists cascade away with it, while
   * **orders and reviews are kept** with their link nulled — the shop's own
   * records and other customers' reading material are not the account's to
   * erase.
   *
   * An ADMIN cannot do this to itself here. Removing an administrator is an
   * admin-panel decision (and `/admin/users` already refuses to remove the
   * last one), so routing it through the storefront form would only create a
   * way to lock everyone out by accident.
   */
  async deleteOwnAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Учётная запись не найдена');

    if (!(await verifyPassword(dto.password, user.passwordHash)))
      throw new BadRequestException('Неверный пароль');

    if (user.role === UserRole.ADMIN)
      throw new BadRequestException(
        'Учётную запись администратора удаляет другой администратор в панели управления',
      );

    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.log(`Account ${user.login} deleted by its owner`);
    return { ok: true };
  }

  /** Removes expired sessions; called by the cleanup cron. */
  async purgeExpiredSessions() {
    const { count } = await this.prisma.userSession.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (count) this.logger.log(`Removed ${count} expired session(s)`);
    return count;
  }
}
