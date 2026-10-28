import { MailService, parseAddressList } from './mail.service';
import { buildCustomerOrderMail, buildOrderMail } from './order-mail';
import type { OrderNotification } from './telegram.service';

const order: OrderNotification = {
  id: 'order-uuid',
  number: 42,
  customerName: '<b>Иван</b>',
  customerPhone: '+375290000000',
  customerEmail: 'ivan@mail.by',
  comment: null,
  deliveryMethod: 'COURIER',
  deliveryAddress: 'Минск',
  paymentMethod: 'CASH',
  currency: 'BYN',
  itemsTotal: 100,
  deliveryCost: 15,
  discountTotal: 0,
  promoCodeLabel: null,
  total: 115,
  items: [{ productName: 'Дрель', quantity: 2, unitPrice: 50, lineTotal: 100 }],
};

describe('MailService', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is disabled unless host, user and password are all set', () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const service = new MailService();
    expect(service.enabled).toBe(false);
    process.env.SMTP_HOST = 'mailbe03.hoster.by';
    process.env.SMTP_USER = 'support@gost.by';
    expect(service.enabled).toBe(false);
    process.env.SMTP_PASSWORD = 'x';
    expect(service.enabled).toBe(true);
    expect(service.from).toBe('support@gost.by');
  });

  it('resolves false instead of sending when disabled', async () => {
    delete process.env.SMTP_HOST;
    process.env.MAIL_ADMIN_TO = 'admin@gost.by';
    await expect(
      new MailService().sendToAdmins({ subject: 's', text: 't' }),
    ).resolves.toBe(false);
  });

  it('splits the admin recipient list', () => {
    expect(parseAddressList(' admin@gost.by, manager@gost.by ;x@y.by')).toEqual(
      ['admin@gost.by', 'manager@gost.by', 'x@y.by'],
    );
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe('buildOrderMail', () => {
  it('carries the order facts and an admin link, replying to the customer', () => {
    const mail = buildOrderMail(order, 'https://gost.by');
    expect(mail.subject).toBe('Новый заказ №42 — 115.00 BYN');
    expect(mail.text).toContain('Дрель — 2 × 50.00 BYN = 100.00 BYN');
    expect(mail.text).toContain('Итого: 115.00 BYN');
    expect(mail.text).toContain(
      'https://gost.by/admin/orders?order=order-uuid',
    );
    expect(mail.replyTo).toBe('ivan@mail.by');
  });

  it('escapes customer text in the HTML part', () => {
    const mail = buildOrderMail(order);
    expect(mail.html).toContain('&lt;b&gt;Иван&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Иван</b>');
  });
});

const companyOrder: OrderNotification = {
  ...order,
  paymentMethod: 'INVOICE',
  payerName: 'ООО «Ромашка»',
  payerTaxId: '391807521',
  payerAddress: 'г. Витебск, ул. Ленина, 1',
  payerAccount: 'BY15AKBB30120000000040000000',
  payerBankName: 'Беларусбанк',
  payerBankBic: 'AKBBBY2X',
};

describe('company orders in letters', () => {
  it('puts the payer first in the shop letter and in its subject', () => {
    const mail = buildOrderMail(companyOrder);
    expect(mail.subject).toBe('Новый заказ №42 — ООО «Ромашка» — 115.00 BYN');
    expect(mail.text).toContain('Организация: ООО «Ромашка»');
    expect(mail.text).toContain('УНП: 391807521');
    expect(mail.text).toContain('Банк: Беларусбанк, БИК AKBBBY2X');
    expect(mail.text).toContain('Контактное лицо: <b>Иван</b>');
    expect(mail.html).toContain('ООО «Ромашка»');
  });

  it('confirms the order to the customer, promising an invoice', () => {
    const mail = buildCustomerOrderMail(companyOrder, 'https://gost.by');
    expect(mail.subject).toBe('Заказ №42 принят — 115.00 BYN');
    expect(mail.text).toContain('пришлёт счёт на оплату');
    expect(mail.text).toContain('УНП: 391807521');
    expect(mail.text).toContain('https://gost.by/account?tab=orders');
    // Never the admin link.
    expect(mail.text).not.toContain('/admin/');
  });

  it('leaves the payer out of a private order', () => {
    const mail = buildCustomerOrderMail(order);
    expect(mail.text).not.toContain('Плательщик');
    expect(mail.text).toContain('свяжется с вами');
  });
});
