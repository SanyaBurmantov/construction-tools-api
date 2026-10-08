import { BadRequestException } from '@nestjs/common';
import { SpecificationsAdminService } from './specifications-admin.service';

function setup() {
  const prisma = {
    specification: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'article',
          name: 'Артикул',
          filterable: false,
          _count: { productSpecs: 10 },
        },
        {
          id: 'power',
          name: 'Мощность',
          filterable: false,
          _count: { productSpecs: 10 },
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({ name: 'Артикул' }),
      update: jest.fn().mockResolvedValue({ filterable: false }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productSpecification: {
      groupBy: jest.fn().mockResolvedValue([
        { specificationId: 'article', value: 'A1' },
        { specificationId: 'article', value: 'A2' },
        { specificationId: 'power', value: '750 Вт' },
        { specificationId: 'power', value: '900 Вт' },
      ]),
    },
  };
  return {
    prisma,
    service: new SpecificationsAdminService(prisma as never),
  };
}

describe('SpecificationsAdminService identity filters', () => {
  it('does not auto-enable article numbers even with few distinct values', async () => {
    const { prisma, service } = setup();
    const { data } = await service.list();
    expect(data.find((spec) => spec.id === 'article')?.recommended).toBe(false);
    expect(data.find((spec) => spec.id === 'power')?.recommended).toBe(true);

    await expect(service.autoSelect()).resolves.toEqual({ enabled: 1 });
    expect(prisma.specification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['power'] } },
      data: { filterable: true },
    });
  });

  it('rejects manually enabling an article filter', async () => {
    const { prisma, service } = setup();
    await expect(service.setFilterable('article', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.specification.update).not.toHaveBeenCalled();
  });

  it('allows disabling a legacy article filter', async () => {
    const { prisma, service } = setup();
    await service.setFilterable('article', false);
    expect(prisma.specification.update).toHaveBeenCalledWith({
      where: { id: 'article' },
      data: { filterable: false },
    });
  });

  it('allows manually enabling an ordinary characteristic', async () => {
    const { prisma, service } = setup();
    prisma.specification.findUnique.mockResolvedValue({ name: 'Мощность' });
    await service.setFilterable('power', true);
    expect(prisma.specification.update).toHaveBeenCalledWith({
      where: { id: 'power' },
      data: { filterable: true },
    });
  });
});
