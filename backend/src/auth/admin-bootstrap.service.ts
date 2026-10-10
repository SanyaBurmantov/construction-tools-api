import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';
import { normalizeLogin } from './login.util';

const DEFAULT_ADMIN_LOGIN = 'admin';

/**
 * The password the first admin account is created with when `ADMIN_PASSWORD`
 * is not set. Committed and known on purpose: a fresh install — local, dev
 * stack or a new server — has a usable `/admin` immediately, and the password
 * is changed from inside the panel right after the first sign-in.
 *
 * Set `ADMIN_PASSWORD` to start from something else instead.
 */
const INITIAL_ADMIN_PASSWORD = 'test-111';

/**
 * Makes sure there is always a way into the admin panel.
 *
 * On boot, if no active ADMIN account exists, one is created with
 * `ADMIN_LOGIN` (default `admin`) and `ADMIN_PASSWORD` — or, when that is not
 * set, `INITIAL_ADMIN_PASSWORD`. So the first login is always known in
 * advance: `admin` / `test-111` on a fresh install.
 *
 * It never touches an existing account: a password an admin changed stays
 * changed, and an admin deleted on purpose is not resurrected while another
 * one is still active.
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.ensureAdmin();
    } catch (error) {
      // A failed bootstrap must not stop the API from starting — the rest of
      // the storefront does not depend on it.
      this.logger.error(
        `Admin bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async ensureAdmin() {
    const existingAdmins = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, isActive: true },
    });
    if (existingAdmins > 0) return;

    const login = normalizeLogin(
      process.env.ADMIN_LOGIN || DEFAULT_ADMIN_LOGIN,
    );
    // `ADMIN_PASSWORD` wins; otherwise the committed initial password, so an
    // admin always exists and the first sign-in never has to be looked up.
    // `ADMIN_TOKEN` is deliberately not consulted here any more: it is the
    // service-to-service header, and reusing it as a password made the first
    // login differ per deployment.
    const configured = process.env.ADMIN_PASSWORD;
    const password = configured || INITIAL_ADMIN_PASSWORD;

    const taken = await this.prisma.user.findUnique({
      where: { login },
      select: { id: true, role: true, isActive: true },
    });
    if (taken) {
      // The login exists but is not an active admin: promoting it silently
      // would hand admin rights to whoever owns that account. Say so instead.
      this.logger.warn(
        `No active admin account. The login "${login}" already belongs to another ` +
          'user, so none was created — set ADMIN_LOGIN to a free login and restart.',
      );
      return;
    }

    await this.prisma.user.create({
      data: {
        login,
        passwordHash: await hashPassword(password),
        role: UserRole.ADMIN,
        name: 'Администратор',
      },
    });

    this.logger.warn(
      configured
        ? `Created the initial admin account "${login}" with the password from ` +
            'ADMIN_PASSWORD. Change it in /admin/users after signing in.'
        : `Created the initial admin account "${login}" / ` +
            `"${INITIAL_ADMIN_PASSWORD}" — the committed initial password. ` +
            'Sign in and change it in /admin/users.',
    );
  }
}
