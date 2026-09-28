import { TelegramService, OrderNotification } from './telegram.service';

function buildOrder(
  overrides: Partial<OrderNotification> = {},
): OrderNotification {
  return {
    id: 'order-uuid',
    number: 42,
    customerName: 'Иван',
    customerPhone: '+375290000000',
    customerEmail: null,
    comment: null,
    deliveryMethod: 'PICKUP',
    deliveryAddress: null,
    paymentMethod: 'CASH',
    currency: 'BYN',
    itemsTotal: 100,
    deliveryCost: 0,
    discountTotal: 0,
    promoCodeLabel: null,
    total: 100,
    items: [
      { productName: 'Дрель', quantity: 2, unitPrice: 50, lineTotal: 100 },
    ],
    ...overrides,
  };
}

describe('TelegramService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is disabled unless both the token and the chat id are set', () => {
    const service = new TelegramService();

    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    expect(service.enabled).toBe(false);

    process.env.TELEGRAM_BOT_TOKEN = 'token';
    expect(service.enabled).toBe(false);

    process.env.TELEGRAM_CHAT_ID = '123';
    expect(service.enabled).toBe(true);
  });

  it('resolves false instead of sending when disabled', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    await expect(
      new TelegramService().notifyNewOrder(buildOrder()),
    ).resolves.toBe(false);
  });

  it('includes the order number, customer and totals', () => {
    const message = new TelegramService().buildMessage(buildOrder());

    expect(message).toContain('Новый заказ №42');
    expect(message).toContain('Иван');
    expect(message).toContain('+375290000000');
    expect(message).toContain('Дрель');
    expect(message).toContain('2 × 50.00 BYN');
    expect(message).toContain('Итого: 100.00 BYN');
  });

  it('shows the discount line only when a discount was applied', () => {
    const without = new TelegramService().buildMessage(buildOrder());
    expect(without).not.toContain('Скидка');

    const withPromo = new TelegramService().buildMessage(
      buildOrder({ discountTotal: 10, promoCodeLabel: 'SALE10', total: 90 }),
    );
    expect(withPromo).toContain('Скидка (SALE10): −10.00 BYN');
  });

  // Customer-controlled text lands in an HTML-parsed message; unescaped angle
  // brackets would make Telegram reject the whole notification.
  it('escapes HTML in customer-supplied fields', () => {
    const message = new TelegramService().buildMessage(
      buildOrder({
        customerName: '<b>Иван</b>',
        comment: 'a & b <script>',
        items: [
          {
            productName: 'Дрель <ударная>',
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
          },
        ],
      }),
    );

    expect(message).toContain('&lt;b&gt;Иван&lt;/b&gt;');
    expect(message).toContain('a &amp; b &lt;script&gt;');
    expect(message).toContain('Дрель &lt;ударная&gt;');
    expect(message).not.toContain('<script>');
  });

  it('appends an admin link when a public origin is configured', () => {
    const message = new TelegramService().buildMessage(
      buildOrder(),
      'https://shop.by',
    );
    expect(message).toContain('https://shop.by/admin/orders?order=order-uuid');
  });

  it('truncates messages that exceed the Telegram length limit', () => {
    const items = Array.from({ length: 400 }, (_, i) => ({
      productName: `Товар номер ${i} с очень длинным названием`,
      quantity: 1,
      unitPrice: 10,
      lineTotal: 10,
    }));

    const message = new TelegramService().buildMessage(buildOrder({ items }));

    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message.endsWith('…')).toBe(true);
  });
});
