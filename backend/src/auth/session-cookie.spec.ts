import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { CustomerType, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { AuthGuard } from './auth.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import type { EmailVerificationService } from './email-verification.service';
import { AuthController } from './auth.controller';
import type { AuthService, SessionContext } from './auth.service';
import type { AuthenticatedRequest } from './auth-request';
import { readSessionToken } from './auth-request';
import {
  assertNotCrossSite,
  parseCookies,
  SESSION_COOKIE,
} from './session-cookie';

type FakeResponse = {
  cookie: jest.Mock;
  clearCookie: jest.Mock;
};

function buildRequest(
  headers: Record<string, string>,
  method = 'GET',
): AuthenticatedRequest {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    method,
    header: (name: string) => lower[name.toLowerCase()],
  } as unknown as AuthenticatedRequest;
}

function buildResponse(): FakeResponse {
  return { cookie: jest.fn(), clearCookie: jest.fn() };
}

function buildContext(
  request: AuthenticatedRequest,
  response = buildResponse(),
) {
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

function session(role: UserRole = UserRole.CUSTOMER): SessionContext {
  return {
    sessionId: 's1',
    user: {
      id: 'u1',
      login: 'someone',
      role,
      customerType: CustomerType.INDIVIDUAL,
      isActive: true,
    },
  };
}

function authWith(result: SessionContext | null) {
  const resolveSession = jest.fn(() => Promise.resolve(result));
  return {
    auth: { resolveSession } as unknown as AuthService,
    resolveSession,
  };
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('parseCookies', () => {
  it('reads name=value pairs, trims, decodes and keeps the first duplicate', () => {
    const cookies = parseCookies(
      ' a=1; sid=abc%2Bdef ; b="q"; sid=second; bad',
    );
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get('sid')).toBe('abc+def');
    expect(cookies.get('b')).toBe('q');
    expect(cookies.has('bad')).toBe(false);
  });

  it('survives an empty header and malformed escapes', () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies('sid=%E0%A4%A').get('sid')).toBe('%E0%A4%A');
  });
});

describe('readSessionToken', () => {
  it('prefers Bearer over the cookie', () => {
    const request = buildRequest({
      authorization: 'Bearer from-header',
      cookie: `${SESSION_COOKIE}=from-cookie`,
    });
    expect(readSessionToken(request)).toEqual({
      token: 'from-header',
      source: 'bearer',
    });
  });

  it('falls back to the session cookie', () => {
    const request = buildRequest({ cookie: `x=1; ${SESSION_COOKIE}=tok` });
    expect(readSessionToken(request)).toEqual({
      token: 'tok',
      source: 'cookie',
    });
  });

  it('is null with neither', () => {
    expect(readSessionToken(buildRequest({ cookie: 'other=1' }))).toBeNull();
  });
});

describe('assertNotCrossSite', () => {
  beforeEach(() => {
    process.env.PUBLIC_ORIGIN = 'https://shop.example';
    delete process.env.CORS_ORIGIN;
  });

  it('never checks safe methods', () => {
    const request = buildRequest({ origin: 'https://evil.example' }, 'GET');
    expect(() => assertNotCrossSite(request)).not.toThrow();
  });

  it('accepts X-Requested-With', () => {
    const request = buildRequest(
      { 'x-requested-with': 'XMLHttpRequest' },
      'POST',
    );
    expect(() => assertNotCrossSite(request)).not.toThrow();
  });

  it('accepts PUBLIC_ORIGIN and the request host', () => {
    expect(() =>
      assertNotCrossSite(
        buildRequest({ origin: 'https://shop.example' }, 'POST'),
      ),
    ).not.toThrow();
    expect(() =>
      assertNotCrossSite(
        buildRequest(
          { origin: 'http://localhost:3000', host: 'localhost:3000' },
          'DELETE',
        ),
      ),
    ).not.toThrow();
    expect(() =>
      assertNotCrossSite(
        buildRequest(
          {
            origin: 'https://shop.example:8443',
            'x-forwarded-host': 'shop.example:8443',
            host: 'backend:8000',
          },
          'PATCH',
        ),
      ),
    ).not.toThrow();
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(() =>
      assertNotCrossSite(
        buildRequest({ referer: 'https://shop.example/account' }, 'POST'),
      ),
    ).not.toThrow();
    expect(() =>
      assertNotCrossSite(
        buildRequest({ referer: 'https://evil.example/x' }, 'POST'),
      ),
    ).toThrow(ForbiddenException);
  });

  it('refuses a foreign origin, Origin: null, and (strict) no origin at all', () => {
    expect(() =>
      assertNotCrossSite(
        buildRequest(
          { origin: 'https://evil.example', host: 'shop.example' },
          'POST',
        ),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertNotCrossSite(buildRequest({ origin: 'null' }, 'POST')),
    ).toThrow(ForbiddenException);
    expect(() => assertNotCrossSite(buildRequest({}, 'POST'))).toThrow(
      ForbiddenException,
    );
  });

  it('non-strict (login/register) lets an origin-less client through, not a foreign one', () => {
    expect(() =>
      assertNotCrossSite(buildRequest({}, 'POST'), false),
    ).not.toThrow();
    expect(() =>
      assertNotCrossSite(
        buildRequest({ origin: 'https://evil.example' }, 'POST'),
        false,
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('guards with the session cookie', () => {
  beforeEach(() => {
    process.env.PUBLIC_ORIGIN = 'https://shop.example';
    process.env.ADMIN_TOKEN = 'service-token';
  });

  const cookie = `${SESSION_COOKIE}=tok`;

  it('AuthGuard accepts a cookie session on GET', async () => {
    const { auth, resolveSession } = authWith(session());
    const request = buildRequest({ cookie });
    const { context } = buildContext(request);
    await expect(new AuthGuard(auth).canActivate(context)).resolves.toBe(true);
    expect(resolveSession).toHaveBeenCalledWith('tok');
    expect(request.authUser?.id).toBe('u1');
  });

  it('AuthGuard refuses a cross-site cookie POST before touching the DB', async () => {
    const { auth, resolveSession } = authWith(session());
    const request = buildRequest(
      { cookie, origin: 'https://evil.example' },
      'POST',
    );
    const { context } = buildContext(request);
    await expect(new AuthGuard(auth).canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it('AuthGuard does not CSRF-check a Bearer POST', async () => {
    const { auth } = authWith(session());
    const request = buildRequest(
      { authorization: 'Bearer tok', origin: 'https://evil.example' },
      'POST',
    );
    const { context } = buildContext(request);
    await expect(new AuthGuard(auth).canActivate(context)).resolves.toBe(true);
  });

  it('AuthGuard clears a dead cookie and answers 401', async () => {
    const { auth } = authWith(null);
    const request = buildRequest({ cookie });
    const { context, response } = buildContext(request);
    await expect(new AuthGuard(auth).canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      expect.objectContaining({ path: '/api', httpOnly: true }),
    );
  });

  it('OptionalAuthGuard treats a dead cookie as a guest and drops it', async () => {
    const { auth } = authWith(null);
    const request = buildRequest(
      { cookie, 'x-requested-with': 'XMLHttpRequest' },
      'POST',
    );
    const { context, response } = buildContext(request);
    await expect(
      new OptionalAuthGuard(auth).canActivate(context),
    ).resolves.toBe(true);
    expect(request.authUser).toBeUndefined();
    expect(response.clearCookie).toHaveBeenCalled();
  });

  it('OptionalAuthGuard refuses a cross-site cookie POST', async () => {
    const { auth } = authWith(session());
    const request = buildRequest({ cookie }, 'POST');
    const { context } = buildContext(request);
    await expect(
      new OptionalAuthGuard(auth).canActivate(context),
    ).rejects.toThrow(ForbiddenException);
  });

  it('AdminGuard: ADMIN cookie session in, CUSTOMER cookie 403, cross-site 403', async () => {
    const admin = authWith(session(UserRole.ADMIN));
    const ok = buildRequest(
      { cookie, origin: 'https://shop.example' },
      'PATCH',
    );
    await expect(
      new AdminGuard(admin.auth).canActivate(buildContext(ok).context),
    ).resolves.toBe(true);

    const customer = authWith(session(UserRole.CUSTOMER));
    await expect(
      new AdminGuard(customer.auth).canActivate(
        buildContext(buildRequest({ cookie })).context,
      ),
    ).rejects.toThrow(ForbiddenException);

    const forged = buildRequest({ cookie }, 'DELETE');
    await expect(
      new AdminGuard(admin.auth).canActivate(buildContext(forged).context),
    ).rejects.toThrow(ForbiddenException);
    expect(admin.resolveSession).toHaveBeenCalledTimes(1);
  });

  it('AdminGuard still takes x-admin-token with no cookie or CSRF proof', async () => {
    const { auth } = authWith(null);
    const request = buildRequest({ 'x-admin-token': 'service-token' }, 'POST');
    await expect(
      new AdminGuard(auth).canActivate(buildContext(request).context),
    ).resolves.toBe(true);
  });
});

describe('AuthController session delivery', () => {
  const expiresAt = new Date('2030-01-01T00:00:00Z');
  const user = { id: 'u1', login: 'someone' };

  function controllerWith(
    overrides: Partial<Record<keyof AuthService, jest.Mock>>,
  ) {
    return new AuthController(
      overrides as unknown as AuthService,
      {} as EmailVerificationService,
    );
  }

  beforeEach(() => {
    delete process.env.AUTH_COOKIE_SECURE;
    delete process.env.AUTH_COOKIE_PATH;
  });

  it('login sets the HttpOnly cookie and keeps the token out of the body', async () => {
    process.env.NODE_ENV = 'production';
    const login = jest.fn(() =>
      Promise.resolve({ token: 'secret', expiresAt, user }),
    );
    const controller = controllerWith({ login });
    const response = buildResponse();
    const body = await controller.login(
      { login: 'someone', password: 'x' },
      buildRequest(
        { origin: 'https://shop.example', host: 'shop.example' },
        'POST',
      ),
      response as unknown as Response,
    );
    expect(body).toEqual({ expiresAt, user });
    expect(body).not.toHaveProperty('token');
    expect(response.cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'secret', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api',
      expires: expiresAt,
    });
  });

  it('Secure is off outside production unless forced', async () => {
    process.env.NODE_ENV = 'development';
    const login = jest.fn(() =>
      Promise.resolve({ token: 'secret', expiresAt, user }),
    );
    const response = buildResponse();
    await controllerWith({ login }).login(
      { login: 'someone', password: 'x' },
      buildRequest({}, 'POST'),
      response as unknown as Response,
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      SESSION_COOKIE,
      'secret',
      expect.objectContaining({ secure: false }),
    );

    process.env.AUTH_COOKIE_SECURE = 'true';
    await controllerWith({ login }).login(
      { login: 'someone', password: 'x' },
      buildRequest({}, 'POST'),
      response as unknown as Response,
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      SESSION_COOKIE,
      'secret',
      expect.objectContaining({ secure: true }),
    );
  });

  it('X-Auth-Transport: bearer returns the token and sets no cookie', async () => {
    const login = jest.fn(() =>
      Promise.resolve({ token: 'secret', expiresAt, user }),
    );
    const response = buildResponse();
    const body = await controllerWith({ login }).login(
      { login: 'someone', password: 'x' },
      buildRequest({ 'x-auth-transport': 'bearer' }, 'POST'),
      response as unknown as Response,
    );
    expect(body).toEqual({ token: 'secret', expiresAt, user });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('login from a foreign origin is refused (login CSRF)', async () => {
    const login = jest.fn();
    await expect(
      controllerWith({ login }).login(
        { login: 'someone', password: 'x' },
        buildRequest({ origin: 'https://evil.example' }, 'POST'),
        buildResponse() as unknown as Response,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(login).not.toHaveBeenCalled();
  });

  it('logout deletes the cookie session and clears the cookie', async () => {
    const logout = jest.fn(() => Promise.resolve({ ok: true }));
    const response = buildResponse();
    await controllerWith({ logout }).logout(
      buildRequest(
        {
          cookie: `${SESSION_COOKIE}=tok`,
          'x-requested-with': 'XMLHttpRequest',
        },
        'POST',
      ),
      response as unknown as Response,
    );
    expect(logout).toHaveBeenCalledWith('tok');
    expect(response.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      expect.objectContaining({ path: '/api' }),
    );
  });

  it('logout-all and account deletion clear the cookie', async () => {
    const logoutEverywhere = jest.fn(() =>
      Promise.resolve({ ok: true, sessions: 2 }),
    );
    const deleteOwnAccount = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = controllerWith({ logoutEverywhere, deleteOwnAccount });
    const me = session().user;

    const r1 = buildResponse();
    await controller.logoutAll(me, r1 as unknown as Response);
    expect(r1.clearCookie).toHaveBeenCalled();

    const r2 = buildResponse();
    await controller.deleteAccount(
      me,
      { password: 'x' },
      r2 as unknown as Response,
    );
    expect(r2.clearCookie).toHaveBeenCalled();
  });

  it('a failed account deletion keeps the cookie', async () => {
    const deleteOwnAccount = jest.fn(() => Promise.reject(new Error('nope')));
    const response = buildResponse();
    await expect(
      controllerWith({ deleteOwnAccount }).deleteAccount(
        session().user,
        { password: 'x' },
        response as unknown as Response,
      ),
    ).rejects.toThrow('nope');
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});
