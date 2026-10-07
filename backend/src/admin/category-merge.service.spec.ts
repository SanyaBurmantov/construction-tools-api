import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoryMergeService } from './category-merge.service';
import { PrismaService } from '../prisma/prisma.service';

// дерево: root ─ child ─ grandchild; other — отдельный корень
const categories = [
  { id: 'root', parentId: null, slug: 'root', level: 0, path: ['root'] },
  {
    id: 'child',
    parentId: 'root',
    slug: 'child',
    level: 1,
    path: ['root', 'child'],
  },
  {
    id: 'grandchild',
    parentId: 'child',
    slug: 'grandchild',
    level: 2,
    path: ['root', 'child', 'grandchild'],
  },
  { id: 'other', parentId: null, slug: 'other', level: 0, path: ['other'] },
];

function buildService() {
  const tx = {
    product: { updateMany: jest.fn(() => Promise.resolve({ count: 7 })) },
    sourceCategory: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    specification: {
      findMany: jest.fn(() => Promise.resolve([])),
      findUnique: jest.fn(() => Promise.resolve(null)),
      update: jest.fn(() => Promise.resolve({})),
      delete: jest.fn(() => Promise.resolve({})),
    },
    productSpecification: {
      findMany: jest.fn(() => Promise.resolve([])),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    category: {
      update: jest.fn(() => Promise.resolve({})),
      delete: jest.fn(() => Promise.resolve({})),
    },
  };
  const prisma = {
    category: { findMany: jest.fn(() => Promise.resolve(categories)) },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new CategoryMergeService(prisma), tx };
}

describe('CategoryMergeService.merge', () => {
  it('rejects merging a category into itself', async () => {
    const { service } = buildService();
    await expect(service.merge('root', 'root')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects merging into its own descendant', async () => {
    const { service } = buildService();
    await expect(service.merge('root', 'grandchild')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown categories', async () => {
    const { service } = buildService();
    await expect(service.merge('ghost', 'other')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.merge('root', 'ghost')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('moves products and mappings, re-parents children with rebuilt paths, deletes the source', async () => {
    const { service, tx } = buildService();
    const result = await service.merge('child', 'other');

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'child' },
      data: { categoryId: 'other' },
    });
    expect(tx.sourceCategory.updateMany).toHaveBeenCalledWith({
      where: { mappedCategoryId: 'child' },
      data: { mappedCategoryId: 'other' },
    });
    // grandchild moves under 'other' with recomputed level/path, and pathKey
    // follows — otherwise the next parse would recreate it at the old place.
    expect(tx.category.update).toHaveBeenCalledWith({
      where: { id: 'grandchild' },
      data: {
        parentId: 'other',
        path: ['other', 'grandchild'],
        level: 1,
        pathKey: 'other/grandchild',
      },
    });
    expect(tx.category.delete).toHaveBeenCalledWith({ where: { id: 'child' } });
    expect(result).toEqual({ ok: true, movedProducts: 7, movedChildren: 1 });
  });
});
