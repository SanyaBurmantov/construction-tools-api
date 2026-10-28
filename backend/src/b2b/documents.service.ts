import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';
import { SellerService, missingForInvoice } from './seller.service';
import { renderDocument, type DocumentLine } from './pdf-documents';
import { QuoteRequestDto } from './dto/b2b.dto';
import { MAX_LINE_QUANTITY } from '../cart/cart-limits';

const DELIVERY_NOTE: Record<string, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Доставка курьером',
  POST: 'Доставка почтой',
};

const round = (value: number) => Math.round(value * 100) / 100;

export type PdfFile = { filename: string; pdf: Buffer };

/**
 * The invoice for an order and the commercial offer for a cart, as PDF.
 *
 * An invoice is issued only when the seller's requisites are complete
 * (bank account, BIC, VAT status — /admin/settings): without them it would be
 * a document nobody can pay. Until then the order still goes through and the
 * storefront says the manager will send the invoice.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private seller: SellerService,
    private leads: LeadsService,
  ) {}

  /** Can this order have an invoice at all (ignoring the seller settings)? */
  static isInvoiceable(order: {
    paymentMethod: string;
    payerName: string | null;
    status: string;
  }) {
    return (
      order.paymentMethod === 'INVOICE' &&
      Boolean(order.payerName) &&
      order.status !== 'CANCELLED'
    );
  }

  /** Whether the storefront may offer the invoice link for this order now. */
  async invoiceAvailable(order: {
    paymentMethod: string;
    payerName: string | null;
    status: string;
  }) {
    return (
      DocumentsService.isInvoiceable(order) &&
      (await this.seller.invoiceReady())
    );
  }

  async invoiceForOrder(orderId: string): Promise<PdfFile> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (!DocumentsService.isInvoiceable(order)) {
      throw new NotFoundException('Для этого заказа счёт не выставляется');
    }
    const seller = await this.seller.get();
    if (missingForInvoice(seller).length) {
      throw new ConflictException(
        'Счёт подготовит менеджер и пришлёт на e-mail в рабочее время',
      );
    }

    const lines: DocumentLine[] = order.items.map((item) => ({
      name: item.productName,
      sku: item.productSku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    }));
    const adjustments: Array<{ label: string; amount: number }> = [];
    if (order.deliveryCost > 0) {
      adjustments.push({ label: 'Доставка', amount: order.deliveryCost });
    }
    if (order.discountTotal > 0) {
      adjustments.push({
        label: order.promoCodeLabel
          ? `Скидка (${order.promoCodeLabel})`
          : 'Скидка',
        amount: -order.discountTotal,
      });
    }
    const delivery = [
      DELIVERY_NOTE[order.deliveryMethod],
      order.deliveryAddress,
    ]
      .filter(Boolean)
      .join(': ');

    const pdf = await renderDocument({
      kind: 'INVOICE',
      number: String(order.number),
      date: order.createdAt,
      seller,
      buyer: {
        name: order.payerName!,
        taxId: order.payerTaxId,
        address: order.payerAddress,
        account: order.payerAccount,
        bankName: order.payerBankName,
        bankBic: order.payerBankBic,
      },
      lines,
      adjustments,
      total: order.total,
      currency: order.currency,
      notes: [
        `Заказ № ${order.number}. ${delivery}.`,
        `Контактное лицо: ${order.customerName}, ${order.customerPhone}.`,
      ],
    });
    return { filename: `schet-${order.number}.pdf`, pdf };
  }

  /**
   * A commercial offer for the lines of a cart, re-priced from the database
   * (the client's prices are never used). Records a QUOTE lead, so a manager
   * sees who is comparing offers.
   */
  async quote(
    dto: QuoteRequestDto,
    userId?: string,
    ip?: string,
  ): Promise<PdfFile> {
    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(
        item.productId,
        Math.min(
          MAX_LINE_QUANTITY,
          (quantities.get(item.productId) ?? 0) + item.quantity,
        ),
      );
    }
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: [...quantities.keys()] },
        status: 'PUBLISHED',
        priceValue: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        priceValue: true,
        priceCurrency: true,
      },
    });
    if (!products.length) {
      throw new NotFoundException('В корзине нет товаров с ценой');
    }
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines: Array<DocumentLine & { productId: string; slug: string }> = [];
    let currency = 'BYN';
    for (const [productId, quantity] of quantities) {
      const product = byId.get(productId);
      if (!product) continue;
      if (product.priceCurrency) currency = product.priceCurrency;
      lines.push({
        productId,
        slug: product.slug,
        name: product.name,
        sku: product.sku,
        quantity,
        unitPrice: product.priceValue!,
        lineTotal: round(product.priceValue! * quantity),
      });
    }
    const total = round(lines.reduce((sum, line) => sum + line.lineTotal, 0));

    const account = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            name: true,
            phone: true,
            email: true,
            companyName: true,
            taxId: true,
          },
        })
      : null;
    const companyName = dto.companyName || account?.companyName || null;
    const taxId = dto.taxId || account?.taxId || null;

    // The honeypot gets its PDF like anyone (a bot learns nothing), but no
    // lead: managers must not call back a script.
    const lead = dto.website?.trim()
      ? null
      : await this.leads.record({
          kind: LeadKind.QUOTE,
          userId,
          companyName,
          taxId,
          contactName: dto.contactName || account?.name,
          phone: dto.phone || account?.phone,
          email: dto.email || account?.email,
          items: lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            slug: line.slug,
            sku: line.sku ?? null,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
          })),
          total,
          currency,
          ip,
        });

    const number = lead ? `К-${lead.number}` : 'К-0';
    const pdf = await renderDocument({
      kind: 'QUOTE',
      number,
      date: new Date(),
      seller: await this.seller.get(),
      buyer: companyName ? { name: companyName, taxId } : null,
      lines,
      total,
      currency,
    });
    return { filename: `kp-${lead?.number ?? 0}.pdf`, pdf };
  }
}
