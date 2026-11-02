import { AdminService } from './admin.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PricingService } from '../pricing/pricing.service';
import type { IndexNowService } from '../seo/indexnow.service';

/**
 * The product form used to send every field on every save, and the update
 * ran the pricing engine whenever the mode it was sent was AUTO — over the
 * cost the form had loaded, clearing a pending spike review. Only a real
 * change of mode or cost re-prices now (audit 2026-10-30).
 */
function build(current: Record<string, unknown>) {
  const row = {
    id: 'p1',
    slug: 'drel',
    name: 'Дрель',
    status: 'PUBLISHED',
    lockedFields: [],
    priceValue: 120,
    oldPrice: null,
    costPrice: 80,
    pricingMode: 'AUTO',
    ...current,
  };
  const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...row, ...data }),
  );
  const prisma = {
    product: {
      findUnique: jest.fn(() => Promise.resolve(row)),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({
        product: { update },
        priceHistory: { create: jest.fn() },
      }),
    ),
  } as unknown as PrismaService;
  const applyCost = jest.fn(() => Promise.resolve());
  const pricing = { applyCost } as unknown as PricingService;
  const indexNow = {
    enqueue: jest.fn(() => Promise.resolve()),
  } as unknown as IndexNowService;
  const unused = null as never;
  const service = new AdminService(
    prisma,
    unused,
    unused,
    unused,
    unused,
    unused,
    pricing,
    unused,
    indexNow,
  );
  return { service, applyCost, update };
}

describe('AdminService.updateProduct pricing', () => {
  it('does not re-price when mode and cost are sent unchanged', async () => {
    const { service, applyCost } = build({});
    await service.updateProduct('p1', {
      name: 'Дрель ударная',
      pricingMode: 'AUTO',
      costPrice: 80,
    });
    expect(applyCost).not.toHaveBeenCalled();
  });

  it('re-prices when the cost changed', async () => {
    const { service, applyCost } = build({});
    await service.updateProduct('p1', { pricingMode: 'AUTO', costPrice: 90 });
    expect(applyCost).toHaveBeenCalledWith('p1', 90, {
      preserveOldPrice: true,
    });
  });

  it('re-prices when the product goes back to AUTO', async () => {
    const { service, applyCost } = build({ pricingMode: 'MANUAL' });
    await service.updateProduct('p1', { pricingMode: 'AUTO' });
    expect(applyCost).toHaveBeenCalled();
  });

  it('an unchanged price does not pin the product to MANUAL', async () => {
    const { service, update } = build({});
    await service.updateProduct('p1', { priceValue: 120 });
    expect(update.mock.calls[0][0].data.pricingMode).toBeUndefined();
  });
});
