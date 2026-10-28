import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { amountInWords } from './amount-in-words';
import type { Seller } from './seller.service';

/**
 * The invoice («Счёт на оплату») and the commercial offer («Коммерческое
 * предложение») as PDF. Pure apart from reading the font files: data in,
 * bytes out, so the layout is tested without a database or a server.
 */

const FONT_DIR = join(process.cwd(), 'assets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'LiberationSans-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'LiberationSans-Bold.ttf');

const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type DocumentLine = {
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type DocumentParty = {
  name: string;
  taxId?: string | null;
  address?: string | null;
  account?: string | null;
  bankName?: string | null;
  bankBic?: string | null;
};

export type DocumentInput = {
  kind: 'INVOICE' | 'QUOTE';
  number: string;
  date: Date;
  seller: Seller;
  /** The payer (invoice) or the addressee (quote, may be unknown). */
  buyer?: DocumentParty | null;
  lines: DocumentLine[];
  /** Extra rows under the goods: delivery, discount. Signed amounts. */
  adjustments?: Array<{ label: string; amount: number }>;
  total: number;
  currency: string;
  /** Free text under the totals (delivery method, contact person…). */
  notes?: string[];
};

const money = (value: number) =>
  value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function formatDocDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** The date `days` calendar days after `date` (an invoice's validity). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The VAT sentence of the totals block, by the shop's tax status. */
export function vatLine(seller: Seller, total: number, currency: string) {
  if (seller.vatMode === 'INCLUDED') {
    const vat =
      Math.round(((total * seller.vatRate) / (100 + seller.vatRate)) * 100) /
      100;
    return `В том числе НДС ${seller.vatRate}%: ${money(vat)} ${currency}`;
  }
  if (seller.vatMode === 'NONE') return 'Без НДС';
  // Not stated yet (only a quote can be issued then): say nothing rather
  // than guess the shop's tax status.
  return '';
}

function partyLines(party: DocumentParty): string[] {
  const lines = [party.name];
  if (party.taxId) lines.push(`УНП ${party.taxId}`);
  if (party.address) lines.push(party.address);
  const bank = [
    party.account && `р/с ${party.account}`,
    party.bankName,
    party.bankBic && `БИК ${party.bankBic}`,
  ]
    .filter(Boolean)
    .join(', ');
  if (bank) lines.push(bank);
  return lines;
}

type Column = {
  title: string;
  width: number;
  align: 'left' | 'right' | 'center';
};

const COLUMNS: Column[] = [
  { title: '№', width: 24, align: 'center' },
  { title: 'Наименование', width: 255, align: 'left' },
  { title: 'Ед.', width: 30, align: 'center' },
  { title: 'Кол-во', width: 46, align: 'right' },
  { title: 'Цена', width: 80, align: 'right' },
  {
    title: 'Сумма',
    width: CONTENT_WIDTH - 24 - 255 - 30 - 46 - 80,
    align: 'right',
  },
];

const CELL_PAD = 4;

function drawRow(
  doc: PDFKit.PDFDocument,
  cells: string[],
  options: { bold?: boolean; fill?: string } = {},
) {
  doc.font(options.bold ? 'bold' : 'regular').fontSize(9);
  const heights = cells.map((text, i) =>
    doc.heightOfString(text, { width: COLUMNS[i].width - CELL_PAD * 2 }),
  );
  const height = Math.max(...heights) + CELL_PAD * 2;

  if (doc.y + height > doc.page.height - MARGIN) {
    doc.addPage();
  }
  const top = doc.y;
  let x = MARGIN;
  if (options.fill) {
    doc.rect(MARGIN, top, CONTENT_WIDTH, height).fill(options.fill);
    doc.fillColor('#000');
  }
  cells.forEach((text, i) => {
    const column = COLUMNS[i];
    doc.rect(x, top, column.width, height).lineWidth(0.5).stroke('#999');
    doc.fillColor('#000').text(text, x + CELL_PAD, top + CELL_PAD, {
      width: column.width - CELL_PAD * 2,
      align: column.align,
    });
    x += column.width;
  });
  doc.x = MARGIN;
  doc.y = top + height;
}

/** Renders the document; resolves with the PDF bytes. */
export function renderDocument(input: DocumentInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `${input.kind === 'INVOICE' ? 'Счёт' : 'КП'} № ${input.number}`,
      Author: input.seller.name,
    },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const { seller } = input;
  const validUntil = formatDocDate(addDays(input.date, seller.validDays));

  // Supplier block.
  doc.font('bold').fontSize(11).text(seller.name);
  doc.font('regular').fontSize(9);
  for (const line of partyLines({
    name: '',
    taxId: seller.unp,
    address: seller.legalAddress,
    account: seller.bankAccount,
    bankName: seller.bankName,
    bankBic: seller.bankBic,
  }).slice(1)) {
    doc.text(line);
  }
  const contacts = [seller.phone, seller.email].filter(Boolean).join(', ');
  if (contacts) doc.text(contacts);

  // Title.
  doc.moveDown(1.2);
  const title =
    input.kind === 'INVOICE'
      ? `Счёт на оплату № ${input.number} от ${formatDocDate(input.date)}`
      : `Коммерческое предложение № ${input.number} от ${formatDocDate(input.date)}`;
  doc.font('bold').fontSize(14).text(title, { align: 'center' });
  doc.moveDown(0.8);

  // Buyer block.
  if (input.buyer?.name) {
    const label = input.kind === 'INVOICE' ? 'Плательщик: ' : 'Кому: ';
    doc.font('bold').fontSize(9).text(label, { continued: true });
    doc.font('regular').text(partyLines(input.buyer).join(', '));
    doc.moveDown(0.6);
  }

  // Lines.
  drawRow(
    doc,
    COLUMNS.map((c, i) => (i >= 4 ? `${c.title}, ${input.currency}` : c.title)),
    { bold: true, fill: '#eeeeee' },
  );
  input.lines.forEach((line, i) => {
    const name = line.sku ? `${line.name}\nАрт. ${line.sku}` : line.name;
    drawRow(doc, [
      String(i + 1),
      name,
      'шт.',
      String(line.quantity),
      money(line.unitPrice),
      money(line.lineTotal),
    ]);
  });

  // Totals.
  doc.moveDown(0.6);
  const totalsX = MARGIN + CONTENT_WIDTH - 260;
  const totalRow = (label: string, value: string, bold = false) => {
    if (doc.y > doc.page.height - MARGIN - 20) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'bold' : 'regular').fontSize(10);
    doc.text(label, totalsX, y, { width: 160, align: 'right' });
    doc.text(value, totalsX + 160, y, { width: 100, align: 'right' });
    doc.x = MARGIN;
  };
  if (input.adjustments?.length) {
    const goods = input.lines.reduce((sum, line) => sum + line.lineTotal, 0);
    totalRow('Товары:', money(Math.round(goods * 100) / 100));
  }
  for (const adjustment of input.adjustments ?? []) {
    totalRow(
      `${adjustment.label}:`,
      `${adjustment.amount < 0 ? '−' : ''}${money(Math.abs(adjustment.amount))}`,
    );
  }
  totalRow(`Итого, ${input.currency}:`, money(input.total), true);
  const vat = vatLine(seller, input.total, input.currency);
  if (vat) {
    doc.font('regular').fontSize(10).text(vat, totalsX, doc.y, {
      width: 260,
      align: 'right',
    });
  }
  doc.x = MARGIN;

  doc.moveDown(0.8);
  doc
    .font('regular')
    .fontSize(10)
    .text(
      `Всего наименований ${input.lines.length}, на сумму ${money(input.total)} ${input.currency}.`,
      MARGIN,
    );
  doc.font('bold').text(amountInWords(input.total));

  doc.moveDown(0.8);
  doc.font('regular').fontSize(9);
  if (input.kind === 'INVOICE') {
    doc.text(
      `Счёт действителен до ${validUntil}. Цены зафиксированы до этой даты; наличие товара подтверждает менеджер. ` +
        `В назначении платежа укажите номер счёта.`,
    );
  } else {
    doc.text(
      `Предложение действительно до ${validUntil}. Цены указаны на дату предложения; ` +
        `для оформления счёта ответьте на это письмо или позвоните ${seller.phone}.`,
    );
  }
  for (const note of input.notes ?? []) doc.text(note);

  if (input.kind === 'INVOICE') {
    doc.moveDown(2);
    doc
      .fontSize(10)
      .text(`${seller.signatory || 'Руководитель'}  ____________________`);
  }

  doc.end();
  return done;
}
