import {
  renderDocument,
  vatLine,
  addDays,
  formatDocDate,
} from './pdf-documents';
import { SELLER_DEFAULTS, type Seller } from './seller.service';

const seller: Seller = {
  ...SELLER_DEFAULTS,
  bankAccount: 'BY15AKBB30120000000040000000',
  bankName: 'ОАО «АСБ Беларусбанк»',
  bankBic: 'AKBBBY2X',
  signatory: 'Директор Иванов И. И.',
  vatMode: 'INCLUDED',
};

describe('pdf documents', () => {
  it('renders an invoice with many lines into a valid PDF', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      name: `Саморез кровельный 4,8×35 мм, упаковка ${i + 1}`,
      sku: `SK-${i}`,
      quantity: 100,
      unitPrice: 0.25,
      lineTotal: 25,
    }));
    const pdf = await renderDocument({
      kind: 'INVOICE',
      number: '42',
      date: new Date('2026-10-28T10:00:00Z'),
      seller,
      buyer: { name: 'ООО «Ромашка»', taxId: '100325912' },
      lines,
      adjustments: [{ label: 'Доставка', amount: 15 }],
      total: 1515,
      currency: 'BYN',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  it('renders a quote without an addressee', async () => {
    const pdf = await renderDocument({
      kind: 'QUOTE',
      number: 'К-7',
      date: new Date(),
      seller: { ...seller, vatMode: 'NONE' },
      lines: [{ name: 'Дрель', quantity: 1, unitPrice: 100, lineTotal: 100 }],
      total: 100,
      currency: 'BYN',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('prints VAT by the seller status', () => {
    expect(vatLine(seller, 120, 'BYN')).toBe('В том числе НДС 20%: 20,00 BYN');
    expect(vatLine({ ...seller, vatMode: 'NONE' }, 120, 'BYN')).toBe('Без НДС');
  });

  it('dates documents in Minsk time', () => {
    // 22:30 UTC is already the next day in Minsk (UTC+3).
    expect(formatDocDate(new Date('2026-10-28T22:30:00Z'))).toBe('29.10.2026');
    expect(formatDocDate(addDays(new Date('2026-10-28T10:00:00Z'), 3))).toBe(
      '31.10.2026',
    );
  });
});
