import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DeliveryMethod, PaymentMethod } from '@prisma/client';
import { fetchWithTimeout } from '../common/utils/fetch-with-timeout';

const TELEGRAM_API = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 8000;
/** One retry is enough: a notification is not worth stalling a cron for. */
const SEND_RETRIES = 1;
/** Telegram rejects messages over 4096 chars. */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * Joins head + items + tail under Telegram's limit by dropping *items*, never
 * the totals or the admin link. A plain `slice()` of the HTML could cut an
 * entity or a `<b>` in half — Telegram then answers 400 "can't parse
 * entities" and the order notification is lost — and on the large orders it
 * affected it cut off «Итого», the line that matters most.
 */
export function fitMessage(
  head: string[],
  items: string[],
  tail: string[],
  limit = MAX_MESSAGE_LENGTH,
): string {
  const join = (lines: string[]) => lines.join('\n');
  const full = join([...head, ...items, ...tail]);
  if (full.length <= limit) return full;

  // Head lines carry customer text (comment, address) that can be long on
  // its own; cap each so the totals always fit. Escaped text never contains
  // a raw `<`, so a cut can only split an `&amp;`-style entity (trimmed back
  // off) or leave the label's `<b>` open (closed again).
  const cap = (line: string, max: number) =>
    `${line.slice(0, max).replace(/&[a-z#0-9]*$/i, '')}…`;
  const safeHead = head.map((line) =>
    line.length > 600 ? closeTags(cap(line, 600)) : line,
  );

  const kept: string[] = [];
  let length = join([...safeHead, ...tail]).length + 40;
  for (const line of items) {
    if (length + line.length + 1 > limit) break;
    kept.push(line);
    length += line.length + 1;
  }
  const dropped = items.length - kept.length;
  const more = dropped > 0 ? [`…и ещё ${dropped} поз.`] : [];
  return join([...safeHead, ...kept, ...more, ...tail]);
}

/** Closes a `<b>` left open by truncation. */
function closeTags(line: string): string {
  const opened = (line.match(/<b>/g) ?? []).length;
  const closed = (line.match(/<\/b>/g) ?? []).length;
  return opened > closed ? `${line}</b>` : line;
}

export const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Наличными',
  CARD: 'Картой',
  INVOICE: 'По счёту',
};

/**
 * The payer as label/value rows — the same lines in Telegram and in both
 * letters. Empty for a private buyer.
 */
export function payerRows(order: OrderNotification): Array<[string, string]> {
  if (!order.payerName) return [];
  const rows: Array<[string, string]> = [['Организация', order.payerName]];
  if (order.payerTaxId) rows.push(['УНП', order.payerTaxId]);
  if (order.payerAddress) rows.push(['Юр. адрес', order.payerAddress]);
  if (order.payerAccount) rows.push(['Р/с', order.payerAccount]);
  const bank = [
    order.payerBankName,
    order.payerBankBic && `БИК ${order.payerBankBic}`,
  ]
    .filter(Boolean)
    .join(', ');
  if (bank) rows.push(['Банк', bank]);
  return rows;
}

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
  /** The organisation the invoice goes to; null for a private buyer. */
  payerName?: string | null;
  payerTaxId?: string | null;
  payerAddress?: string | null;
  payerAccount?: string | null;
  payerBankName?: string | null;
  payerBankBic?: string | null;
  /** «yandex / cpc» … — where the buyer came from. */
  trafficSource?: string | null;
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

type TelegramTarget = { chatId: string; threadId: string };

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

  /**
   * Orders and operator alerts go to different places — usually two topics of
   * one forum group, so a parser or 5xx alert never buries a new order. Each
   * alert setting falls back to the order chat.
   */
  private target(kind: 'orders' | 'alerts'): TelegramTarget {
    const env = (name: string) => process.env[name]?.trim() || '';
    if (kind === 'orders') {
      return { chatId: this.chatId, threadId: env('TELEGRAM_THREAD_ID') };
    }
    const alertChat = env('TELEGRAM_ALERT_CHAT_ID');
    return {
      chatId: alertChat || this.chatId,
      threadId:
        env('TELEGRAM_ALERT_THREAD_ID') ||
        (alertChat ? '' : env('TELEGRAM_THREAD_ID')),
    };
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

    lines.push(
      order.payerName
        ? `🏢 <b>Новый заказ №${order.number} от организации</b>`
        : `🛒 <b>Новый заказ №${order.number}</b>`,
    );
    lines.push('');
    // A company order is billed, so the manager needs the requisites first,
    // not after a trip to the admin.
    const payer = payerRows(order);
    if (payer.length) {
      for (const [label, value] of payer) {
        lines.push(`<b>${label}:</b> ${this.escape(value)}`);
      }
      lines.push('');
    }
    lines.push(
      `<b>${order.payerName ? 'Контактное лицо' : 'Покупатель'}:</b> ${this.escape(order.customerName)}`,
    );
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
    if (order.trafficSource) {
      lines.push(`<b>Источник:</b> ${this.escape(order.trafficSource)}`);
    }
    if (order.comment) {
      lines.push(`<b>Комментарий:</b> ${this.escape(order.comment)}`);
    }

    lines.push('');
    lines.push('<b>Состав заказа:</b>');
    const itemLines = order.items.map(
      (item) =>
        `• ${this.escape(item.productName)} — ${item.quantity} × ${this.money(item.unitPrice, order.currency)} = ${this.money(item.lineTotal, order.currency)}`,
    );

    const tail: string[] = [''];
    tail.push(`Товары: ${this.money(order.itemsTotal, order.currency)}`);
    if (order.discountTotal > 0) {
      const promo = order.promoCodeLabel
        ? ` (${this.escape(order.promoCodeLabel)})`
        : '';
      tail.push(
        `Скидка${promo}: −${this.money(order.discountTotal, order.currency)}`,
      );
    }
    tail.push(
      `Доставка: ${order.deliveryCost > 0 ? this.money(order.deliveryCost, order.currency) : 'бесплатно'}`,
    );
    tail.push(`<b>Итого: ${this.money(order.total, order.currency)}</b>`);
    if (adminUrl) {
      tail.push('');
      tail.push(`${adminUrl}/admin/orders?order=${order.id}`);
    }

    return fitMessage(lines, itemLines, tail);
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

    return this.send(lines.join('\n'), `parser ${problem.key}`, 'alerts');
  }

  /**
   * Outgoing mail is broken (wrong password, blocked port). Order letters and
   * registration confirmations silently stop otherwise. Throttled by
   * MailService.
   */
  async notifyMailProblem(account: string, reason: string): Promise<boolean> {
    const lines = [
      '📧 <b>Почта не отправляется</b>',
      `<b>Ящик:</b> ${this.escape(account)}`,
      `<b>Причина:</b> ${this.escape(reason.slice(0, 500))}`,
      'Письма о заказах и подтверждения регистрации не уходят. Проверьте SMTP_PASSWORD в .env.prod.',
    ];
    return this.send(lines.join('\n'), 'mail problem', 'alerts');
  }

  /**
   * A new kind of 5xx in production. The caller (ErrorLogService) sends it
   * only for a fingerprint it has not alerted on recently, so a broken
   * endpoint under load is one message, not one per request.
   */
  async notifyServerError(error: {
    statusCode: number;
    method: string;
    path: string;
    message: string;
  }): Promise<boolean> {
    const lines = [
      `🔴 <b>Ошибка ${error.statusCode} на проде</b>`,
      `<code>${this.escape(error.method)} ${this.escape(error.path.slice(0, 300))}</code>`,
      this.escape(error.message.slice(0, 500)),
    ];
    const origin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
    if (origin) lines.push(`${origin}/admin/errors`);

    return this.send(lines.join('\n'), 'server error', 'alerts');
  }

  /** What holds the API heap (sampling profiler), sent to the alerts topic. */
  async notifyMemoryReport(
    reason: 'warn' | 'restart',
    describe: string,
    retainers: string[],
  ): Promise<boolean> {
    const title =
      reason === 'restart'
        ? '🔴 <b>API перезапускается: куча почти заполнена</b>'
        : '🟠 <b>API: память растёт</b>';
    const lines = [title, this.escape(describe)];
    if (retainers.length) {
      lines.push('', '<b>Кто держит память:</b>');
      lines.push(
        `<pre>${this.escape(retainers.join('\n')).slice(0, 3000)}</pre>`,
      );
    }
    return this.send(lines.join('\n'), 'memory report', 'alerts');
  }

  /**
   * Fire-and-forget POST shared by every notification.
   *
   * Goes through `fetchWithTimeout` like every other outbound call in the
   * backend, so a slow Telegram cannot hang the caller: a hard timeout per
   * attempt, bounded retries with backoff and `Retry-After` on 429/5xx.
   * Never throws — the order is already committed by the time we get here.
   */
  private async send(
    text: string,
    context?: string,
    kind: 'orders' | 'alerts' = 'orders',
  ): Promise<boolean> {
    if (!this.enabled) return false;

    const { chatId, threadId } = this.target(kind);

    const label = context ? ` (${context})` : '';

    try {
      const res = await fetchWithTimeout(
        `${TELEGRAM_API}/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            ...(threadId ? { message_thread_id: Number(threadId) } : {}),
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

  /**
   * A lead (quote downloaded, a question about a product). Goes to the
   * orders topic: it is sales work, not an operator alert.
   */
  async notifyLead(text: string, context: string): Promise<boolean> {
    return this.send(text, context, 'orders');
  }

  async notifyNewOrder(order: OrderNotification): Promise<boolean> {
    if (!this.enabled) return false;

    const publicOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
    const message = this.buildMessage(order, publicOrigin);

    return this.send(message, `order #${order.number}`);
  }
}
