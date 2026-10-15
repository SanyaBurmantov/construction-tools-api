import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoryMergeService } from './category-merge.service';
import { PrismaService } from '../prisma/prisma.service';

// дерево: root ─ child ─ grandchild; other — отдельный корень
const categories = [
  {
    id: 'root',
    name: 'Root',
    parentId: null,
    slug: 'root',
    level: 0,
    path: ['root'],
  },
  {
    id: 'child',
    name: 'Child',
    parentId: 'root',
    slug: 'child',
    level: 1,
    path: ['root', 'child'],
  },
  {
    id: 'grandchild',
    name: 'Grandchild',
    parentId: 'child',
    slug: 'grandchild',
    level: 2,
    path: ['root', 'child', 'grandchild'],
  },
  {
    id: 'other',
    name: 'Other',
    parentId: null,
    slug: 'other',
    level: 0,
    path: ['other'],
  },
];

function buildService(rows = categories) {
  const tx = {
    product: { updateMany: jest.fn(() => Promise.resolve({ count: 7 })) },
    sourceCategory: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    pricingRule: { updateMany: jest.fn(() => Promise.resolve({ count: 1 })) },
    categoryRedirect: {
      updateMany: jest.fn(() => Promise.resolve({ count: 2 })),
      upsert: jest.fn(() => Promise.resolve({})),
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
    category: {
      // A fresh copy per call: the merge updates its in-memory index.
      findMany: jest.fn(() =>
        Promise.resolve(rows.map((row) => ({ ...row, path: [...row.path] }))),
      ),
    },
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
    expect(tx.pricingRule.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'child' },
      data: { categoryId: 'other' },
    });
    expect(tx.categoryRedirect.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'child' },
      data: { categoryId: 'other' },
    });
    expect(tx.categoryRedirect.upsert).toHaveBeenCalledWith({
      where: { slug: 'child' },
      create: { slug: 'child', categoryId: 'other' },
      update: { categoryId: 'other' },
    });
    expect(tx.category.delete).toHaveBeenCalledWith({ where: { id: 'child' } });
    expect(result).toEqual({
      ok: true,
      movedProducts: 7,
      movedChildren: 1,
      mergedChildren: 0,
    });
  });
});

// The nightly root merge, as it happened in prod: the supplier root and the
// canonical one both have «Двигатель»; the supplier's one also has «Свечи».
const rootsWithTwins = [
  {
    id: 'canon',
    name: 'Наборы инструментов',
    parentId: null,
    slug: 'nabory',
    level: 0,
    path: ['nabory'],
  },
  {
    id: 'canon-engine',
    name: 'Двигатель',
    parentId: 'canon',
    slug: 'dvigatel',
    level: 1,
    path: ['nabory', 'dvigatel'],
  },
  {
    id: 'supplier',
    name: 'Специальный инструмент',
    parentId: null,
    slug: 'specialnyi-instrument',
    level: 0,
    path: ['specialnyi-instrument'],
  },
  {
    id: 'supplier-engine',
    name: 'двигатель',
    parentId: 'supplier',
    slug: 'specialnyi-instrument-dvigatel',
    level: 1,
    path: ['specialnyi-instrument', 'specialnyi-instrument-dvigatel'],
  },
  {
    id: 'supplier-plugs',
    name: 'Свечи',
    parentId: 'supplier-engine',
    slug: 'svechi',
    level: 2,
    path: ['specialnyi-instrument', 'specialnyi-instrument-dvigatel', 'svechi'],
  },
];

describe('CategoryMergeService deep merge', () => {
  it('folds a same-named child into the target’s child instead of placing it beside it', async () => {
    const { service, tx } = buildService(rootsWithTwins);
    const result = await service.merge('supplier', 'canon');

    // The supplier «Двигатель» goes into the canonical «Двигатель»…
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'supplier-engine' },
      data: { categoryId: 'canon-engine' },
    });
    expect(tx.categoryRedirect.upsert).toHaveBeenCalledWith({
      where: { slug: 'specialnyi-instrument-dvigatel' },
      create: {
        slug: 'specialnyi-instrument-dvigatel',
        categoryId: 'canon-engine',
      },
      update: { categoryId: 'canon-engine' },
    });
    // …its own child moves under the canonical «Двигатель»…
    expect(tx.category.update).toHaveBeenCalledWith({
      where: { id: 'supplier-plugs' },
      data: {
        parentId: 'canon-engine',
        path: ['nabory', 'dvigatel', 'svechi'],
        level: 2,
        pathKey: 'nabory/dvigatel/svechi',
      },
    });
    // …and no «Двигатель» is re-parented under the canonical root.
    expect(tx.category.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'supplier-engine' } }),
    );
    expect(tx.category.delete).toHaveBeenCalledWith({
      where: { id: 'supplier-engine' },
    });
    expect(tx.category.delete).toHaveBeenCalledWith({
      where: { id: 'supplier' },
    });
    expect(result).toMatchObject({ movedChildren: 0, mergedChildren: 1 });
  });
});

describe('CategoryMergeService.mergeDuplicates', () => {
  const siblings = [
    ...categories,
    {
      id: 'child-2',
      name: '  child ',
      parentId: 'root',
      slug: 'child-2',
      level: 1,
      path: ['root', 'child-2'],
    },
  ];

  it('merges each same-named sibling into the target', async () => {
    const { service, tx } = buildService(siblings);
    const result = await service.mergeDuplicates('child', ['child-2']);
    expect(tx.category.delete).toHaveBeenCalledWith({
      where: { id: 'child-2' },
    });
    expect(result).toMatchObject({ ok: true, merged: 1 });
  });

  it('refuses anything that is not a same-named sibling', async () => {
    const { service } = buildService(siblings);
    await expect(service.mergeDuplicates('child', ['other'])).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.mergeDuplicates('child', ['child'])).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.mergeDuplicates('ghost', ['child'])).rejects.toThrow(
      NotFoundException,
    );
  });
});
