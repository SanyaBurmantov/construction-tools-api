import { OffersService } from './offers.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ProductMergeService } from './product-merge.service';

type Offer = { id: string; productId: string | null };

function createService(options: {
  offer?: Offer | null;
  remainingOffers?: number;
  productStatus?: string;
}) {
  const productUpdates: Record<string, unknown>[] = [];
  const offerUpdates: Record<string, unknown>[] = [];

  const prisma = {
    sourceProduct: {
      findUnique: jest.fn(() => Promise.resolve(options.offer ?? null)),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        offerUpdates.push(data);
        return Promise.resolve({});
      }),
      findMany: jest.fn(() => Promise.resolve([])),
      count: jest.fn(() => Promise.resolve(options.remainingOffers ?? 0)),
    },
    product: {
      findUnique: jest.fn(() =>
        Promise.resolve({ status: options.productStatus ?? 'PUBLISHED' }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        productUpdates.push(data);
        return Promise.resolve({});
      }),
    },
  } as unknown as PrismaService;

  const pricing = { applyCost: jest.fn() } as unknown as PricingService;
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
    expect(productUpdates).toHaveLength(0);
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

  it('does nothing for a URL we never had an offer for', async () => {
    const { service, offerUpdates } = createService({ offer: null });

    await expect(service.delistOffer('s1', 'https://x/none')).resolves.toEqual({
      delisted: false,
      productHidden: false,
    });
    expect(offerUpdates).toHaveLength(0);
  });
});
