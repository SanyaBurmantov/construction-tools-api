import { BRANDS_CACHE_TTL_MS, BrandsService } from './brands.service';
import type { PrismaService } from '../prisma/prisma.service';

function setup(findMany: jest.Mock) {
  return new BrandsService({
    brand: { findMany },
  } as unknown as PrismaService);
}

describe('BrandsService.findAll', () => {
  it('shares one query among concurrent and later callers within the TTL', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'b1' }]);
    const service = setup(findMany);

    const [a, b] = await Promise.all([
      service.findAll(1_000),
      service.findAll(1_000),
    ]);
    await service.findAll(1_000 + BRANDS_CACHE_TTL_MS - 1);

    expect(a).toEqual([{ id: 'b1' }]);
    expect(b).toBe(a);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('asks again once the TTL is over', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = setup(findMany);

    await service.findAll(0);
    await service.findAll(BRANDS_CACHE_TTL_MS);

    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failure', async () => {
    const findMany = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ id: 'b1' }]);
    const service = setup(findMany);

    await expect(service.findAll(0)).rejects.toThrow('db down');
    await expect(service.findAll(1)).resolves.toEqual([{ id: 'b1' }]);
  });
});
