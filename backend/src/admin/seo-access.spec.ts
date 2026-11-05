import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CustomerType, UserRole } from '@prisma/client';
import { AdminGuard } from './admin.guard';
import {
  AdminOnly,
  assertSeoChanges,
  forbiddenSeoChanges,
  productForSeo,
  SeoAccess,
} from './seo-access';
import type { AuthService } from '../auth/auth.service';

@SeoAccess()
class OpenController {
  read() {}
  @AdminOnly()
  spend() {}
}

class ClosedController {
  read() {}
  @SeoAccess()
  report() {}
}

function contextFor(cls: { prototype: object }, method: string) {
  const request = {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? 'Bearer t' : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (cls.prototype as Record<string, unknown>)[method],
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

function guardFor(role: UserRole) {
  const auth = {
    resolveSession: jest.fn().mockResolvedValue({
      sessionId: 's',
      user: {
        id: 'u',
        login: 'seo',
        role,
        customerType: CustomerType.INDIVIDUAL,
        isActive: true,
      },
    }),
  } as unknown as AuthService;
  return new AdminGuard(auth);
}

describe('SEO access in AdminGuard', () => {
  it('lets an SEO session in only where a route or its controller allows it', async () => {
    const guard = guardFor(UserRole.SEO);
    await expect(
      guard.canActivate(contextFor(OpenController, 'read')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(ClosedController, 'report')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(ClosedController, 'read')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps an @AdminOnly route of an open controller closed', async () => {
    await expect(
      guardFor(UserRole.SEO).canActivate(contextFor(OpenController, 'spend')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('changes nothing for ADMIN and CUSTOMER', async () => {
    await expect(
      guardFor(UserRole.ADMIN).canActivate(
        contextFor(ClosedController, 'read'),
      ),
    ).resolves.toBe(true);
    await expect(
      guardFor(UserRole.CUSTOMER).canActivate(
        contextFor(OpenController, 'read'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SEO edits', () => {
  const differs = (a: unknown, b: unknown) => (a ?? null) !== (b ?? null);
  const stored = {
    name: 'Шуруп',
    seoTitle: null,
    priceValue: 10,
    status: 'PUBLISHED',
    categoryId: 'c1',
  };

  it('accepts the whole form when only text fields changed', () => {
    const dto = {
      name: 'Шуруп 4×40',
      seoTitle: 'Шуруп купить',
      priceValue: 10,
      status: 'PUBLISHED',
      categoryId: 'c1',
    };
    expect(forbiddenSeoChanges('product', dto, stored, differs)).toEqual([]);
  });

  it('names every protected field that changed', () => {
    const dto = { priceValue: 9, status: 'HIDDEN', categoryId: 'c1' };
    const fields = forbiddenSeoChanges('product', dto, stored, differs);
    expect(fields).toEqual(['priceValue', 'status']);
    expect(() => assertSeoChanges(fields)).toThrow(/цена, статус/);
  });

  it('keeps a brand name and a category place out of reach', () => {
    expect(
      forbiddenSeoChanges(
        'brand',
        { name: 'X', description: 'd' },
        { name: 'Y' },
        differs,
      ),
    ).toEqual(['name']);
    expect(
      forbiddenSeoChanges(
        'category',
        { parentId: 'p2', seoTitle: 't' },
        { parentId: 'p1' },
        differs,
      ),
    ).toEqual(['parentId']);
  });

  it('hides costs and supplier offers from the product it returns', () => {
    const shown = productForSeo({
      id: 'p',
      name: 'n',
      priceValue: 10,
      costPrice: 8,
      priceReviewNeeded: false,
      sourceProducts: [{ url: 'https://supplier' }],
    });
    expect(shown).toEqual({ id: 'p', name: 'n', priceValue: 10 });
  });
});
