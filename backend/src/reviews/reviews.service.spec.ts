import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

function buildService(
  options: {
    product?: { id: string } | null;
    existingForProduct?: { id: string; status?: string } | null;
    duplicateText?: { id: string } | null;
    recentCount?: number;
    /** A matching non-cancelled order, i.e. a verified purchase. */
    purchase?: { id: string } | null;
  } = {},
) {
  const {
    product = { id: 'p1' },
    existingForProduct = null,
    duplicateText = null,
    recentCount = 0,
    purchase = null,
  } = options;

  type CreateArgs = {
    data: {
      status: string;
      ipHash: string | null;
      [key: string]: unknown;
    };
  };
  const createMock = jest.fn((args: CreateArgs) =>
    Promise.resolve({ id: 'r1', ...args.data }),
  );
  // findFirst is used twice: same-IP-same-product, then duplicate text.
  const findFirstMock = jest
    .fn()
    .mockResolvedValueOnce(existingForProduct)
    .mockResolvedValueOnce(duplicateText);

  const orderFindFirstMock = jest.fn((args: { where?: unknown }) => {
    orderQueries.push(args.where);
    return Promise.resolve(purchase);
  });
  const orderQueries: unknown[] = [];

  const prisma = {
    product: {
      findFirst: jest.fn(() => Promise.resolve(product)),
    },
    review: {
      findFirst: findFirstMock,
      count: jest.fn(() => Promise.resolve(recentCount)),
      create: createMock,
    },
    order: {
      findFirst: orderFindFirstMock,
    },
  } as unknown as PrismaService;

  return { service: new ReviewsService(prisma), createMock, orderQueries };
}

const baseDto: CreateReviewDto = {
  authorName: 'Пётр',
  rating: 5,
  text: 'Отличная дрель, берите смело.',
};

describe('ReviewsService.create', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.REVIEW_IP_SALT = 'test-salt';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('stores a review as PENDING with a hashed ip', async () => {
    const { service, createMock } = buildService();

    const result = await service.create('drel', baseDto, '10.0.0.1');

    expect(result.ok).toBe(true);
    const data = createMock.mock.calls[0][0].data;
    expect(data.status).toBe('PENDING');
    // The raw address must never reach the database.
    expect(data.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain('10.0.0.1');
  });

  it('produces a stable hash for the same ip and different ones otherwise', async () => {
    const a = buildService();
    const b = buildService();
    const c = buildService();

    await a.service.create('drel', baseDto, '10.0.0.1');
    await b.service.create('drel', baseDto, '10.0.0.1');
    await c.service.create('drel', baseDto, '10.0.0.2');

    const hashA = a.createMock.mock.calls[0][0].data.ipHash;
    const hashB = b.createMock.mock.calls[0][0].data.ipHash;
    const hashC = c.createMock.mock.calls[0][0].data.ipHash;

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });

  // A bot that learns it was caught just stops filling the field.
  it('silently drops a honeypot submission without storing it', async () => {
    const { service, createMock } = buildService();

    const result = await service.create(
      'drel',
      { ...baseDto, website: 'http://spam.example' },
      '10.0.0.1',
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Спасибо');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a second review for the same product from the same ip', async () => {
    const { service, createMock } = buildService({
      existingForProduct: { id: 'r0' },
    });

    await expect(
      service.create('drel', baseDto, '10.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects once the daily per-ip cap is reached', async () => {
    const { service, createMock } = buildService({ recentCount: 5 });

    await expect(
      service.create('drel', baseDto, '10.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('allows a submission below the daily cap', async () => {
    const { service, createMock } = buildService({ recentCount: 4 });

    await service.create('drel', baseDto, '10.0.0.1');

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  // Catches spam that rotates IPs but reuses the same payload.
  it('silently drops identical text already posted on the product', async () => {
    const { service, createMock } = buildService({
      duplicateText: { id: 'r0' },
    });

    const result = await service.create('drel', baseDto, '10.0.0.9');

    expect(result.ok).toBe(true);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('still works when the ip is unknown', async () => {
    const { service, createMock } = buildService();

    await service.create('drel', baseDto, undefined);

    expect(createMock.mock.calls[0][0].data.ipHash).toBeNull();
  });

  it('rejects a review for a product that is not published', async () => {
    const { service } = buildService({ product: null });

    await expect(
      service.create('ghost', baseDto, '10.0.0.1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReviewsService.create from an account', () => {
  it('links the review to the account and marks a verified purchase', async () => {
    const { service, createMock } = buildService({ purchase: { id: 'o1' } });

    await service.create('drel', baseDto, '203.0.113.5', 'u1');

    const data = createMock.mock.calls[0][0].data;
    expect(data.userId).toBe('u1');
    expect(data.isVerifiedPurchase).toBe(true);
    // The IP is still hashed and kept: it is what duplicate detection uses.
    expect(data.ipHash).toBeTruthy();
  });

  it('does not claim a verified purchase without a matching order', async () => {
    const { service, createMock } = buildService({ purchase: null });

    await service.create('drel', baseDto, undefined, 'u1');

    expect(createMock.mock.calls[0][0].data.isVerifiedPurchase).toBe(false);
  });

  it('ignores cancelled orders when verifying the purchase', async () => {
    const { service, orderQueries } = buildService({ purchase: { id: 'o1' } });

    await service.create('drel', baseDto, undefined, 'u1');

    expect(orderQueries[0]).toEqual({
      userId: 'u1',
      status: { not: 'CANCELLED' },
      items: { some: { productId: 'p1' } },
    });
  });

  it('refuses a second review of the same product from the same account', async () => {
    const { service } = buildService({
      existingForProduct: { id: 'r0', status: 'APPROVED' },
    });

    await expect(
      service.create('drel', baseDto, '203.0.113.5', 'u1'),
    ).rejects.toThrow('Вы уже оставили отзыв на этот товар.');
  });

  /**
   * Behind carrier-grade NAT several customers share one address, so the
   * per-IP rules are the ones that reject genuine reviews. An account is a
   * better identity, so those rules step aside for it.
   */
  it('is not blocked by another customer on the same IP', async () => {
    const { service, createMock } = buildService({
      existingForProduct: null,
      recentCount: 99,
    });

    await service.create('drel', baseDto, '203.0.113.5', 'u1');
    expect(createMock).toHaveBeenCalled();
  });

  it('still drops a honeypot submission from an account', async () => {
    const { service, createMock } = buildService();
    const result = await service.create(
      'drel',
      { ...baseDto, website: 'http://spam' },
      '203.0.113.5',
      'u1',
    );
    expect(result.ok).toBe(true);
    expect(createMock).not.toHaveBeenCalled();
  });
});
