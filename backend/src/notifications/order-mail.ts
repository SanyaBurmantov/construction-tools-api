import type { MailMessage } from './mail.service';
import { escapeHtml } from './mail.service';
import {
  DELIVERY_LABELS,
  PAYMENT_LABELS,
  type OrderNotification,
} from './telegram.service';

const money = (value: number, currency: string) =>
  `${value.toFixed(2)} ${currency}`;

/**
 * The new-order letter to the shop's mailbox — the same facts as the Telegram
 * message, as plain text plus a simple HTML table. Pure, so it is tested
 * without an SMTP server. Customer-supplied text is escaped in the HTML part.
 */
export function buildOrderMail(
  order: OrderNotification,
  adminUrl?: string,
): Omit<MailMessage, 'to'> {
  const c = order.currency;
  const rows: Array<[string, string]> = [
    ['Покупатель', order.customerName],
    ['Телефон', order.customerPhone],
  ];
  if (order.customerEmail) rows.push(['E-mail', order.customerEmail]);
  rows.push(['Доставка', DELIVERY_LABELS[order.deliveryMethod]]);
  if (order.deliveryAddress) rows.push(['Адрес', order.deliveryAddress]);
  rows.push(['Оплата', PAYMENT_LABELS[order.paymentMethod]]);
  if (order.comment) rows.push(['Комментарий', order.comment]);

  const totals: Array<[string, string]> = [
    ['Товары', money(order.itemsTotal, c)],
  ];
  if (order.discountTotal > 0) {
    const promo = order.promoCodeLabel ? ` (${order.promoCodeLabel})` : '';
    totals.push([`Скидка${promo}`, `−${money(order.discountTotal, c)}`]);
  }
  totals.push([
    'Доставка',
    order.deliveryCost > 0 ? money(order.deliveryCost, c) : 'бесплатно',
  ]);
  totals.push(['Итого', money(order.total, c)]);

  const link = adminUrl ? `${adminUrl}/admin/orders?order=${order.id}` : '';

  const text = [
    `Новый заказ №${order.number}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Состав заказа:',
    ...order.items.map(
      (item) =>
        `• ${item.productName} — ${item.quantity} × ${money(item.unitPrice, c)} = ${money(item.lineTotal, c)}`,
    ),
    '',
    ...totals.map(([k, v]) => `${k}: ${v}`),
    ...(link ? ['', link] : []),
  ].join('\n');

  const cell = 'padding:4px 8px;border-bottom:1px solid #eee;';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">Новый заказ №${order.number}</h2>
<table style="border-collapse:collapse;margin-bottom:16px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="${cell}color:#666">${k}</td><td style="${cell}">${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>
<table style="border-collapse:collapse;margin-bottom:16px">
<tr><th style="${cell}text-align:left">Товар</th><th style="${cell}">Кол-во</th><th style="${cell}text-align:right">Цена</th><th style="${cell}text-align:right">Сумма</th></tr>${order.items
    .map(
      (item) =>
        `<tr><td style="${cell}">${escapeHtml(item.productName)}</td><td style="${cell}text-align:center">${item.quantity}</td><td style="${cell}text-align:right">${money(item.unitPrice, c)}</td><td style="${cell}text-align:right">${money(item.lineTotal, c)}</td></tr>`,
    )
    .join('')}</table>
<table style="border-collapse:collapse">${totals
    .map(
      ([k, v]) =>
        `<tr><td style="${cell}color:#666">${escapeHtml(k)}</td><td style="${cell}text-align:right"><b>${v}</b></td></tr>`,
    )
    .join('')}</table>${
    link
      ? `\n<p style="margin-top:16px"><a href="${escapeHtml(link)}">Открыть заказ в админке</a></p>`
      : ''
  }
</div>`;

  return {
    subject: `Новый заказ №${order.number} — ${money(order.total, c)}`,
    text,
    html,
    // «Ответить» in the mail client writes straight to the customer.
    replyTo: order.customerEmail || undefined,
  };
}
