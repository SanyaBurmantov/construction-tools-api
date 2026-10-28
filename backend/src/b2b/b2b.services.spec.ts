import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { MailService } from '../notifications/mail.service';
import { DocumentsService } from './documents.service';
import { LeadsService } from './leads.service';
import { PriceListService } from './price-list.service';
import { normalizeLines } from './purchase-lists.service';
import {
  SELLER_DEFAULTS,
  SellerService,
  missingForInvoice,
  type Seller,
} from './seller.service';
import { buildLeadMail, buildLeadTelegram } from './lead-messages';

const readySeller = {
  ...SELLER_DEFAULTS,
  bankAccount: 'BY15AKBB30120000000040000000',
  bankName: 'Беларусбанк',
  bankBic: 'AKBBBY2X',
  vatMode: 'NONE' as const,
};

function leadsService(count = 0) {
  const create = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'lead-1', number: 7, ...args.data }),
  );
  const prisma = {
    lead: { create, count: jest.fn(() => Promise.resolve(count)) },
    product: { findUnique: jest.fn(() => Promise.resolve(null)) },
  } as unknown as PrismaService;
  const notifyLead = jest.fn(() => Promise.resolve(true));
  const sendToAdmins = jest.fn(() => Promise.resolve(true));
  const telegram = { notifyLead } as unknown as TelegramService;
  const mail = { sendToAdmins } as unknown as MailService;
  return {
    service: new LeadsService(prisma, telegram, mail),
    create,
    notifyLead,
    sendToAdmins,
  };
}

describe('missingForInvoice', () => {
  it('lists the bank details and the VAT status until they are set', () => {
    expect(missingForInvoice(SELLER_DEFAULTS)).toEqual([
      'bankAccount',
      'bankName',
      'bankBic',
      'vatMode',
    ]);
    expect(missingForInvoice(readySeller)).toEqual([]);
  });
});

describe('SellerService', () => {
  it('reads stored rows over the code defaults', async () => {
    const prisma = {
      siteSetting: {
        findMany: jest.fn(() =>
          Promise.resolve([
            { key: 'seller.bankName', value: 'Беларусбанк' },
            { key: 'seller.vatMode', value: 'INCLUDED' },
            { key: 'seller.validDays', value: '5' },
            { key: 'seller.vatMode-junk', value: 'x' },
          ]),
        ),
      },
    } as unknown as PrismaService;
    const seller = await new SellerService(prisma).get();
    expect(seller.bankName).toBe('Беларусбанк');
    expect(seller.vatMode).toBe('INCLUDED');
    expect(seller.validDays).toBe(5);
    expect(seller.name).toBe(SELLER_DEFAULTS.name);
  });
});

describe('LeadsService', () => {
  it('records a question and notifies both channels', async () => {
    const { service, create, notifyLead, sendToAdmins } = leadsService();
    await service.createQuestion(
      {
        contactName: 'Пётр',
        phone: '+375291112233',
        message: 'Есть аналог?',
        taxId: '391 807 521',
      },
      undefined,
      '1.2.3.4',
    );
    const data = create.mock.calls[0][0].data;
    expect(data.kind).toBe('QUESTION');
    expect(data.taxId).toBe('391807521');
    // Never the address itself.
    expect(data.ipHash).not.toContain('1.2.3.4');
    await new Promise((resolve) => setImmediate(resolve));
    expect(notifyLead).toHaveBeenCalled();
    expect(sendToAdmins).toHaveBeenCalled();
  });

  it('answers a honeypot hit like a success and stores nothing', async () => {
    const { service, create } = leadsService();
    await expect(
      service.createQuestion({
        contactName: 'bot',
        phone: '00000',
        message: 'x',
        website: 'spam',
      }),
    ).resolves.toEqual({ ok: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses past the per-IP daily budget', async () => {
    const { service } = leadsService(20);
    await expect(
      service.createQuestion(
        { contactName: 'Пётр', phone: '+375291112233', message: 'x' },
        undefined,
        '1.2.3.4',
      ),
    ).rejects.toThrow(/Слишком много/);
  });
});

describe('lead messages', () => {
  const lead = {
    id: 'l1',
    number: 7,
    kind: 'QUOTE' as const,
    companyName: 'ООО <Ромашка>',
    taxId: '391807521',
    contactName: null,
    phone: null,
    email: 'buyer@x.by',
    message: null,
    productName: null,
    productSlug: null,
    total: 125,
    currency: 'BYN',
    items: Array.from({ length: 20 }, (_, i) => ({
      name: `Товар ${i}`,
      quantity: 2,
      lineTotal: 1,
    })),
  };

  it('escapes visitor text and cuts long item lists', () => {
    const text = buildLeadTelegram(lead, 'https://gost.by');
    expect(text).toContain('ООО &lt;Ромашка&gt;');
    expect(text).toContain('…и ещё 5 поз.');
    expect(text).toContain('https://gost.by/admin/leads');
  });

  it('replies to the visitor from the mail', () => {
    const mail = buildLeadMail(lead);
    expect(mail.replyTo).toBe('buyer@x.by');
    expect(mail.subject).toContain('№7');
  });
});

describe('DocumentsService', () => {
  const order = {
    id: 'o1',
    number: 42,
    status: 'NEW',
    paymentMethod: 'INVOICE',
    payerName: 'ООО «Ромашка»',
    payerTaxId: '391807521',
    payerAddress: null,
    payerAccount: null,
    payerBankName: null,
    payerBankBic: null,
    deliveryMethod: 'PICKUP',
    deliveryAddress: null,
    deliveryCost: 0,
    discountTotal: 0,
    promoCodeLabel: null,
    total: 100,
    currency: 'BYN',
    customerName: 'Иван',
    customerPhone: '+375290000000',
    createdAt: new Date(),
    items: [
      {
        productName: 'Дрель',
        productSku: 'D1',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      },
    ],
  };

  function documents(seller: Seller = readySeller, row: unknown = order) {
    const prisma = {
      order: { findUnique: jest.fn(() => Promise.resolve(row)) },
    } as unknown as PrismaService;
    const sellerService = {
      get: jest.fn(() => Promise.resolve(seller)),
    } as unknown as SellerService;
    return new DocumentsService(prisma, sellerService, {} as LeadsService);
  }

  it('renders the invoice of a company order', async () => {
    const file = await documents().invoiceForOrder('o1');
    expect(file.filename).toBe('schet-42.pdf');
    expect(file.pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses until the seller requisites are complete', async () => {
    await expect(
      documents(SELLER_DEFAULTS).invoiceForOrder('o1'),
    ).rejects.toThrow(/менеджер/);
  });

  it('has no invoice for a cash order or a cancelled one', async () => {
    await expect(
      documents(readySeller, {
        ...order,
        paymentMethod: 'CASH',
      }).invoiceForOrder('o1'),
    ).rejects.toThrow(/не выставляется/);
    await expect(
      documents(readySeller, { ...order, status: 'CANCELLED' }).invoiceForOrder(
        'o1',
      ),
    ).rejects.toThrow(/не выставляется/);
  });
});

describe('PriceListService', () => {
  it('streams a workbook with a header and one row per product', async () => {
    const page = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`,
      sku: `S${i}`,
      name: `Товар ${i}`,
      slug: `tovar-${i}`,
      priceValue: 10 + i,
      stockStatus: i ? 'in_stock' : 'out_of_stock',
      brand: { name: 'Bosch' },
      category: { name: 'Дрели' },
    }));
    const prisma = {
      product: { findMany: jest.fn(() => Promise.resolve(page)) },
    } as unknown as PrismaService;
    const service = new PriceListService(prisma);
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    const prepared = await service.prepare({});
    expect(prepared.filename).toBe('gost-by-price.xlsx');
    await service.write(prepared, out);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Прайс')!;
    expect(sheet.getRow(3).getCell(2).value).toBe('Наименование');
    expect(sheet.getRow(4).getCell(2).value).toBe('Товар 0');
    expect(sheet.getRow(4).getCell(6).value).toBe('под заказ');
    expect(sheet.rowCount).toBe(6);
  });
});

describe('normalizeLines', () => {
  it('merges duplicate products and caps the quantity', () => {
    expect(
      normalizeLines([
        { productId: 'a', quantity: 9000 },
        { productId: 'b', quantity: 1 },
        { productId: 'a', quantity: 2000 },
      ]),
    ).toEqual([
      { productId: 'a', quantity: 9999 },
      { productId: 'b', quantity: 1 },
    ]);
  });
});
