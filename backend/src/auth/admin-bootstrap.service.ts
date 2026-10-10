import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';
import { normalizeLogin } from './login.util';

const DEFAULT_ADMIN_LOGIN = 'admin';

/**
 * Makes sure there is always a way into the admin panel.
 *
 * On boot, if no active ADMIN account exists, one is created from
 * `ADMIN_LOGIN` (default `admin`) and `ADMIN_PASSWORD`, falling back to
 * `ADMIN_TOKEN` so a deployment that already has the shared token needs no new
 * secret — the first login is then `admin` + the value of `ADMIN_TOKEN`.
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
    const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;

    if (!password) {
      this.logger.warn(
        'No admin account and neither ADMIN_PASSWORD nor ADMIN_TOKEN is set — ' +
          'nobody can sign in to /admin. Set one and restart.',
      );
      return;
    }

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
      `Created the initial admin account "${login}" with the password from ` +
        `${process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD' : 'ADMIN_TOKEN'}. ` +
        'Change it in /admin/users after signing in.',
    );
  }
}
