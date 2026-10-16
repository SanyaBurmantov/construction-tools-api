import {
  TelegramService,
  OrderNotification,
  fitMessage,
} from './telegram.service';

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

  // The send goes through `fetchWithTimeout`, like every other outbound call
  // in the backend — axios had neither a retry nor a guaranteed timeout.
  describe('sending', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'token';
      process.env.TELEGRAM_CHAT_ID = '123';
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('posts the message to the bot API and resolves true', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        new TelegramService().notifyNewOrder(buildOrder()),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method?: string; body?: string },
      ];
      expect(url).toBe('https://api.telegram.org/bottoken/sendMessage');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body ?? '{}') as {
        chat_id: string;
        text: string;
        parse_mode: string;
      };
      expect(body.chat_id).toBe('123');
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('Новый заказ №42');
    });

    // The order is already committed when this runs: a rejected message must
    // be logged and swallowed, never thrown back at the request.
    it('resolves false when Telegram rejects the message', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          new Response('{"description":"chat not found"}', { status: 400 }),
        ) as unknown as typeof fetch;

      await expect(
        new TelegramService().notifyNewOrder(buildOrder()),
      ).resolves.toBe(false);
    });

    it('resolves false when the request fails outright, after a retry', async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        new TelegramService().notifyParserProblem({
          key: 'th-tools',
          label: 'th.by',
          reason: 'нет успешных запусков',
        }),
      ).resolves.toBe(false);

      // One retry: a notification is not worth stalling the caller for more.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
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
    // Items are dropped; the totals survive.
    expect(message).toMatch(/…и ещё \d+ поз\./);
    expect(message).toContain('Итого');
  });
});

describe('fitMessage', () => {
  const head = [
    '<b>Новый заказ</b>',
    '<b>Комментарий:</b> ' + 'а'.repeat(2000),
  ];
  const items = Array.from(
    { length: 200 },
    (_, i) => `• Товар ${i} — 1 × 10 = 10`,
  );
  const tail = [
    '',
    '<b>Итого: 2000 BYN</b>',
    'https://gost.by/admin/orders?order=1',
  ];

  it('drops items, never the totals or the admin link', () => {
    const message = fitMessage(head, items, tail, 4000);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).toContain('<b>Итого: 2000 BYN</b>');
    expect(message).toContain('/admin/orders?order=1');
    expect(message).toMatch(/…и ещё \d+ поз\./);
  });

  it('keeps tags balanced when a long comment is cut', () => {
    const message = fitMessage(head, items, tail, 4000);
    const opened = (message.match(/<b>/g) ?? []).length;
    const closed = (message.match(/<\/b>/g) ?? []).length;
    expect(opened).toBe(closed);
  });

  it('leaves a short message alone', () => {
    expect(fitMessage(['a'], ['b'], ['c'])).toBe('a\nb\nc');
  });
});
