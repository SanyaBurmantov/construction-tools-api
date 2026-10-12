import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DeliveryMethod, PaymentMethod } from '@prisma/client';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';

const TELEGRAM_API = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 8000;
/** One retry is enough: a notification is not worth stalling a cron for. */
const SEND_RETRIES = 1;
/** Telegram rejects messages over 4096 chars. */
const MAX_MESSAGE_LENGTH = 4000;

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Наличными',
  CARD: 'Картой',
  INVOICE: 'По счёту',
};

export type OrderNotification = {
  id: string;
  number: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  comment: string | null;
  deliveryMethod: DeliveryMethod;
  deliveryAddress: string | null;
  paymentMethod: PaymentMethod;
  currency: string;
  itemsTotal: number;
  deliveryCost: number;
  discountTotal: number;
  promoCodeLabel: string | null;
  total: number;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
};

/**
 * Sends new-order notifications to a Telegram chat.
 *
 * Disabled unless both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, so the
 * app runs unchanged without them. Sending never throws: a notification failure
 * must not affect an order that is already committed.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  private get botToken() {
    return process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  }

  private get chatId() {
    return process.env.TELEGRAM_CHAT_ID?.trim() || '';
  }

  get enabled() {
    return Boolean(this.botToken && this.chatId);
  }

  onModuleInit() {
    if (this.enabled) {
      this.logger.log('Telegram order notifications enabled');
    } else {
      this.logger.warn(
        'Telegram order notifications disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable',
      );
    }
  }

  /** Escapes the three characters that break Telegram's HTML parse mode. */
  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private money(value: number, currency: string) {
    return `${value.toFixed(2)} ${currency}`;
  }

  buildMessage(order: OrderNotification, adminUrl?: string): string {
    const lines: string[] = [];

    lines.push(`🛒 <b>Новый заказ №${order.number}</b>`);
    lines.push('');
    lines.push(`<b>Покупатель:</b> ${this.escape(order.customerName)}`);
    lines.push(`<b>Телефон:</b> ${this.escape(order.customerPhone)}`);
    if (order.customerEmail) {
      lines.push(`<b>Email:</b> ${this.escape(order.customerEmail)}`);
    }
    lines.push('');
    lines.push(`<b>Доставка:</b> ${DELIVERY_LABELS[order.deliveryMethod]}`);
    if (order.deliveryAddress) {
      lines.push(`<b>Адрес:</b> ${this.escape(order.deliveryAddress)}`);
    }
    lines.push(`<b>Оплата:</b> ${PAYMENT_LABELS[order.paymentMethod]}`);
    if (order.comment) {
      lines.push(`<b>Комментарий:</b> ${this.escape(order.comment)}`);
    }

    lines.push('');
    lines.push('<b>Состав заказа:</b>');
    for (const item of order.items) {
      lines.push(
        `• ${this.escape(item.productName)} — ${item.quantity} × ${this.money(item.unitPrice, order.currency)} = ${this.money(item.lineTotal, order.currency)}`,
      );
    }

    lines.push('');
    lines.push(`Товары: ${this.money(order.itemsTotal, order.currency)}`);
    if (order.discountTotal > 0) {
      const promo = order.promoCodeLabel
        ? ` (${this.escape(order.promoCodeLabel)})`
        : '';
      lines.push(
        `Скидка${promo}: −${this.money(order.discountTotal, order.currency)}`,
      );
    }
    lines.push(
      `Доставка: ${order.deliveryCost > 0 ? this.money(order.deliveryCost, order.currency) : 'бесплатно'}`,
    );
    lines.push(`<b>Итого: ${this.money(order.total, order.currency)}</b>`);

    if (adminUrl) {
      lines.push('');
      lines.push(`${adminUrl}/admin/orders?order=${order.id}`);
    }

    const message = lines.join('\n');
    return message.length > MAX_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_MESSAGE_LENGTH)}\n…`
      : message;
  }

  /**
   * Tells the operator a parser is broken, so "the catalogue stopped growing"
   * is noticed in half an hour instead of next week. Deduplicated by the caller:
   * an already-broken job must not re-alert every 30 minutes.
   */
  async notifyParserProblem(problem: {
    key: string;
    label: string;
    reason: string;
  }): Promise<boolean> {
    const lines = [
      '⚠️ <b>Парсер требует внимания</b>',
      `<b>Задание:</b> ${this.escape(problem.label)} (${this.escape(problem.key)})`,
      `<b>Причина:</b> ${this.escape(problem.reason)}`,
    ];
    const origin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
    if (origin) lines.push(`${origin}/admin/parsing`);

    return this.send(lines.join('\n'), `parser ${problem.key}`);
  }

  /**
   * Fire-and-forget POST shared by every notification.
   *
   * Goes through `fetchWithTimeout` like every other outbound call in the
   * backend, so a slow Telegram cannot hang the caller: a hard timeout per
   * attempt, bounded retries with backoff and `Retry-After` on 429/5xx.
   * Never throws — the order is already committed by the time we get here.
   */
  private async send(text: string, context?: string): Promise<boolean> {
    if (!this.enabled) return false;

    const label = context ? ` (${context})` : '';

    try {
      const res = await fetchWithTimeout(
        `${TELEGRAM_API}/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        },
        { timeoutMs: SEND_TIMEOUT_MS, retries: SEND_RETRIES },
      );

      if (!res.ok) {
        // Telegram explains a rejected message in the body (bad chat id,
        // broken HTML) — that detail is the whole value of the log line.
        const detail = await res.text().catch(() => '');
        this.logger.error(
          `Telegram send failed${label}: HTTP ${res.status} ${detail.slice(0, 500)}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Telegram send failed${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async notifyNewOrder(order: OrderNotification): Promise<boolean> {
    if (!this.enabled) return false;

    const publicOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
    const message = this.buildMessage(order, publicOrigin);

    return this.send(message, `order #${order.number}`);
  }
}
