import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CustomerType, UserRole } from '@prisma/client';
import { AdminGuard } from './admin.guard';
import type { AuthService, SessionContext } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth-request';

function buildContext(headers: Record<string, string>) {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as AuthenticatedRequest;

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function buildGuard(session: SessionContext | null = null) {
  const resolveSession = jest.fn(() => Promise.resolve(session));
  const auth = { resolveSession } as unknown as AuthService;
  return { guard: new AdminGuard(auth), resolveSession };
}

const adminSession: SessionContext = {
  sessionId: 's1',
  user: {
    id: 'u1',
    login: 'admin',
    role: UserRole.ADMIN,
    customerType: CustomerType.INDIVIDUAL,
    isActive: true,
  },
};

describe('AdminGuard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'service-token';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('x-admin-token (service path)', () => {
    it('lets the configured token through without touching sessions', async () => {
      const { guard, resolveSession } = buildGuard();
      const { context, request } = buildContext({
        'x-admin-token': 'service-token',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.adminToken).toBe(true);
      expect(resolveSession).not.toHaveBeenCalled();
    });

    it('rejects a wrong token', async () => {
      const { guard } = buildGuard();
      const { context } = buildContext({ 'x-admin-token': 'nope' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid admin token',
      );
    });

    it('rejects every token when ADMIN_TOKEN is unset', async () => {
      delete process.env.ADMIN_TOKEN;
      const { guard } = buildGuard();
      const { context } = buildContext({ 'x-admin-token': 'anything' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'ADMIN_TOKEN is not configured',
      );
    });
  });

  describe('account session', () => {
    it('lets an ADMIN session through and attaches the account', async () => {
      const { guard, resolveSession } = buildGuard(adminSession);
      const { context, request } = buildContext({
        authorization: 'Bearer abc123',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(resolveSession).toHaveBeenCalledWith('abc123');
      expect(request.authUser).toEqual(adminSession.user);
      expect(request.authSessionId).toBe('s1');
      // No service token was used, so "lock myself out" checks can rely on it.
      expect(request.adminToken).toBeUndefined();
    });

    it('answers 403 for a valid customer session', async () => {
      const { guard } = buildGuard({
        sessionId: 's2',
        user: { ...adminSession.user, role: UserRole.CUSTOMER },
      });
      const { context } = buildContext({ authorization: 'Bearer abc123' });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('answers 401 for an unknown or expired token', async () => {
      const { guard } = buildGuard(null);
      const { context } = buildContext({ authorization: 'Bearer abc123' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Сессия истекла',
      );
    });

    it('ignores a non-bearer authorization header', async () => {
      const { guard, resolveSession } = buildGuard(adminSession);
      const { context } = buildContext({ authorization: 'Basic abc123' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Требуется авторизация администратора',
      );
      expect(resolveSession).not.toHaveBeenCalled();
    });
  });

  it('rejects a request with no credentials at all', async () => {
    const { guard } = buildGuard();
    const { context } = buildContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Требуется авторизация администратора',
    );
  });
});
