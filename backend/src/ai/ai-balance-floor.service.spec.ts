import { BadRequestException } from '@nestjs/common';
import {
  AiBalanceFloorService,
  MIN_BALANCE_KEY,
} from './ai-balance-floor.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiClient } from './ai.client';

/** A SiteSetting table of one key, and a DeepSeek account. */
function setup(balances: Record<string, number> | null = { CNY: 37.24 }) {
  const rows = new Map<string, string>();
  const prisma = {
    siteSetting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          rows.has(where.key)
            ? { key: where.key, value: rows.get(where.key) }
            : null,
        ),
      ),
      upsert: jest.fn(
        ({
          where,
          update,
        }: {
          where: { key: string };
          update: { value: string };
        }) => {
          rows.set(where.key, update.value);
          return Promise.resolve();
        },
      ),
      deleteMany: jest.fn(({ where }: { where: { key: string } }) => {
        rows.delete(where.key);
        return Promise.resolve();
      }),
    },
  } as unknown as PrismaService;
  const client = {
    quota: jest.fn(() => Promise.resolve(balances ? { balances } : null)),
  } as unknown as AiClient;
  return { service: new AiBalanceFloorService(prisma, client), rows };
}

describe('AiBalanceFloorService', () => {
  const env = process.env.AI_MIN_BALANCE;
  afterEach(() => {
    if (env === undefined) delete process.env.AI_MIN_BALANCE;
    else process.env.AI_MIN_BALANCE = env;
  });

  it('falls back to AI_MIN_BALANCE while the admin has set nothing', async () => {
    process.env.AI_MIN_BALANCE = '36.37 CNY';
    const { service } = setup();
    expect(await service.setting()).toEqual({
      value: '36.37 CNY',
      source: 'env',
      env: '36.37 CNY',
    });
    expect(await service.aboveFloor('test')).toBe(true);
  });

  it('the admin value wins over the env, and a reset brings the env back', async () => {
    process.env.AI_MIN_BALANCE = '36.37 CNY';
    const { service, rows } = setup({ CNY: 30 });
    expect(await service.aboveFloor('test')).toBe(false);

    await service.set(' 20  cny ');
    expect(rows.get(MIN_BALANCE_KEY)).toBe('20 cny');
    expect((await service.setting()).source).toBe('admin');
    expect(await service.aboveFloor('test')).toBe(true);

    await service.set(null);
    expect(rows.has(MIN_BALANCE_KEY)).toBe(false);
    expect(await service.aboveFloor('test')).toBe(false);
  });

  it('an empty admin value is «no floor», even with the env set', async () => {
    process.env.AI_MIN_BALANCE = '36.37 CNY';
    const { service } = setup({ CNY: 1 });
    await service.set('');
    expect(await service.setting()).toMatchObject({
      value: '',
      source: 'admin',
    });
    expect(await service.aboveFloor('test')).toBe(true);
  });

  it('refuses a value that is not a floor', async () => {
    const { service, rows } = setup();
    await expect(service.set('много')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows.size).toBe(0);
  });

  it('stops when a floor is set but the balance cannot be read', async () => {
    delete process.env.AI_MIN_BALANCE;
    const { service } = setup(null);
    expect(await service.aboveFloor('test')).toBe(true); // no floor at all
    await service.set('5');
    expect(await service.aboveFloor('test')).toBe(false);
  });
});
