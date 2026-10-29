import { OffersService } from './offers.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ProductMergeService } from './product-merge.service';

type Offer = { id: string; productId: string | null; price?: number | null };

function createService(options: {
  offer?: Offer | null;
  remainingOffers?: number;
  productStatus?: string;
  statusSource?: 'SYSTEM' | 'ADMIN';
}) {
  const productUpdates: Record<string, unknown>[] = [];
  const offerUpdates: Record<string, unknown>[] = [];

  const prisma = {
    sourceProduct: {
      // A live offer has a price; `price: null` means already withdrawn.
      findUnique: jest.fn(() =>
        Promise.resolve(options.offer ? { price: 10, ...options.offer } : null),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        offerUpdates.push(data);
        return Promise.resolve({});
      }),
      // The offers still carrying a price — consistent with `count` below.
      findMany: jest.fn(() =>
        Promise.resolve(
          Array.from({ length: options.remainingOffers ?? 0 }, () => ({
            price: 12,
            stock: true,
            specifications: {},
          })),
        ),
      ),
      count: jest.fn(() => Promise.resolve(options.remainingOffers ?? 0)),
    },
    product: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          status: options.productStatus ?? 'PUBLISHED',
          statusSource: options.statusSource ?? 'SYSTEM',
        }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        productUpdates.push(data);
        return Promise.resolve({});
      }),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  } as unknown as PrismaService;

  const pricing = {
    applyCost: jest.fn(),
    withdrawPrice: jest.fn(() => Promise.resolve(false)),
  } as unknown as PricingService;
  const merge = { syncMatchKeys: jest.fn() } as unknown as ProductMergeService;

  return {
    service: new OffersService(prisma, pricing, merge),
    productUpdates,
    offerUpdates,
  };
}

describe('OffersService.delistOffer', () => {
  it('clears price and stock so the dead offer stops setting the price', async () => {
    const { service, offerUpdates } = createService({
      offer: { id: 'o1', productId: 'p1' },
      remainingOffers: 1,
    });

    await service.delistOffer('s1', 'https://x/1');

    expect(offerUpdates[0]).toMatchObject({ stock: false, price: null });
  });

  it('keeps the product visible while another supplier still carries it', async () => {
    const { service, productUpdates } = createService({
      offer: { id: 'o1', productId: 'p1' },
      remainingOffers: 2,
    });

    const result = await service.delistOffer('s1', 'https://x/1');

    expect(result).toEqual({ delisted: true, productHidden: false });
    expect(productUpdates.some((data) => data.status === 'HIDDEN')).toBe(false);
  });

  it('hides a product nobody carries any more', async () => {
    const { service, productUpdates } = createService({
      offer: { id: 'o1', productId: 'p1' },
      remainingOffers: 0,
    });

    const result = await service.delistOffer('s1', 'https://x/1');

    expect(result).toEqual({ delisted: true, productHidden: true });
    expect(productUpdates[0]).toMatchObject({
      status: 'HIDDEN',
      stockStatus: 'out_of_stock',
    });
  });

  it('never reclassifies a product an admin archived', async () => {
    const { service, productUpdates } = createService({
      offer: { id: 'o1', productId: 'p1' },
      remainingOffers: 0,
      productStatus: 'ARCHIVED',
    });

    const result = await service.delistOffer('s1', 'https://x/1');

    expect(result.productHidden).toBe(false);
    expect(productUpdates[0]).toEqual({ stockStatus: 'out_of_stock' });
  });

  // An admin chose to keep it on sale; a delist marks it out of stock only.
  it('leaves a status an admin set alone', async () => {
    const { service, productUpdates } = createService({
      offer: { id: 'o1', productId: 'p1' },
      remainingOffers: 0,
      statusSource: 'ADMIN',
    });

    const result = await service.delistOffer('s1', 'https://x/1');

    expect(result.productHidden).toBe(false);
    expect(productUpdates[0]).toEqual({ stockStatus: 'out_of_stock' });
  });

  // The weekly re-check of SKIPPED rows lands on withdrawn offers again.
  it('does nothing for an offer that is already withdrawn', async () => {
    const { service, offerUpdates } = createService({
      offer: { id: 'o1', productId: 'p1', price: null },
    });

    await expect(service.delistOffer('s1', 'https://x/1')).resolves.toEqual({
      delisted: false,
      productHidden: false,
    });
    expect(offerUpdates).toHaveLength(0);
  });

  it('does nothing for a URL we never had an offer for', async () => {
    const { service, offerUpdates } = createService({ offer: null });

    await expect(service.delistOffer('s1', 'https://x/none')).resolves.toEqual({
      delisted: false,
      productHidden: false,
    });
    expect(offerUpdates).toHaveLength(0);
  });
});
