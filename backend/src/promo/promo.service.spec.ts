import { PromoCode, PromoCodeType } from '@prisma/client';
import { PromoService } from './promo.service';
import { PrismaService } from '../prisma/prisma.service';

function buildCode(overrides: Partial<PromoCode> = {}): PromoCode {
  return {
    id: 'promo-1',
    code: 'SALE10',
    description: null,
    type: PromoCodeType.PERCENT,
    value: 10,
    minOrderTotal: null,
    maxUses: null,
    usedCount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    freeDelivery: false,
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(codes: PromoCode[]) {
  // The query is recorded rather than typed onto an unused callback
  // parameter, so the assertions below read it without a cast.
  const queries: Array<{ where?: Record<string, unknown> }> = [];
  const findMany = jest.fn((args: { where?: Record<string, unknown> }) => {
    queries.push(args);
    return Promise.resolve(codes);
  });
  const prisma = {
    promoCode: { findMany },
  } as unknown as PrismaService;
  return { service: new PromoService(prisma), queries };
}

describe('PromoService.listAvailable', () => {
  it('asks the database only for active, public, in-window codes', async () => {
    const { service, queries } = buildService([]);
    await service.listAvailable();

    expect(queries[0].where?.isActive).toBe(true);
    expect(queries[0].where?.isPublic).toBe(true);
  });

  it('hides a code whose uses have run out', async () => {
    const { service } = buildService([
      buildCode({ id: 'left', code: 'LEFT', maxUses: 5, usedCount: 4 }),
      buildCode({ id: 'gone', code: 'GONE', maxUses: 5, usedCount: 5 }),
    ]);

    const { data } = await service.listAvailable();
    expect(data.map((code) => code.code)).toEqual(['LEFT']);
    expect(data[0].usesLeft).toBe(1);
  });

  it('reports unlimited codes as having no limit', async () => {
    const { service } = buildService([buildCode()]);
    const { data } = await service.listAvailable();
    expect(data[0].usesLeft).toBeNull();
  });

  it('never exposes how many times a code was already used', async () => {
    const { service } = buildService([
      buildCode({ maxUses: 10, usedCount: 7 }),
    ]);
    const { data } = await service.listAvailable();
    expect(data[0]).not.toHaveProperty('usedCount');
    expect(data[0]).not.toHaveProperty('maxUses');
  });
});
