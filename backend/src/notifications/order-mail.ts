import type { MailMessage } from './mail.service';
import { escapeHtml } from './mail.service';
import {
  DELIVERY_LABELS,
  PAYMENT_LABELS,
  payerRows,
  type OrderNotification,
} from './telegram.service';

const money = (value: number, currency: string) =>
  `${value.toFixed(2)} ${currency}`;

type Rows = Array<[string, string]>;

const CELL = 'padding:4px 8px;border-bottom:1px solid #eee;';

/** Totals block shared by both letters. */
function totalRows(order: OrderNotification): Rows {
  const c = order.currency;
  const totals: Rows = [['Товары', money(order.itemsTotal, c)]];
  if (order.discountTotal > 0) {
    const promo = order.promoCodeLabel ? ` (${order.promoCodeLabel})` : '';
    totals.push([`Скидка${promo}`, `−${money(order.discountTotal, c)}`]);
  }
  totals.push([
    'Доставка',
    order.deliveryCost > 0 ? money(order.deliveryCost, c) : 'бесплатно',
  ]);
  totals.push(['Итого', money(order.total, c)]);
  return totals;
}

function itemTextLines(order: OrderNotification): string[] {
  const c = order.currency;
  return order.items.map(
    (item) =>
      `• ${item.productName} — ${item.quantity} × ${money(item.unitPrice, c)} = ${money(item.lineTotal, c)}`,
  );
}

function rowsTable(rows: Rows, boldValues = false) {
  return `<table style="border-collapse:collapse;margin-bottom:16px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="${CELL}color:#666">${escapeHtml(k)}</td><td style="${CELL}${boldValues ? 'text-align:right;font-weight:bold' : ''}">${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>`;
}

function itemsTable(order: OrderNotification) {
  const c = order.currency;
  return `<table style="border-collapse:collapse;margin-bottom:16px">
<tr><th style="${CELL}text-align:left">Товар</th><th style="${CELL}">Кол-во</th><th style="${CELL}text-align:right">Цена</th><th style="${CELL}text-align:right">Сумма</th></tr>${order.items
    .map(
      (item) =>
        `<tr><td style="${CELL}">${escapeHtml(item.productName)}</td><td style="${CELL}text-align:center">${item.quantity}</td><td style="${CELL}text-align:right">${money(item.unitPrice, c)}</td><td style="${CELL}text-align:right">${money(item.lineTotal, c)}</td></tr>`,
    )
    .join('')}</table>`;
}

function textSection(title: string, rows: Rows): string[] {
  return rows.length ? [title, ...rows.map(([k, v]) => `${k}: ${v}`), ''] : [];
}

function htmlSection(title: string, rows: Rows): string {
  return rows.length
    ? `<h3 style="margin:0 0 8px">${escapeHtml(title)}</h3>${rowsTable(rows)}`
    : '';
}

/**
 * The new-order letter to the shop's mailbox — the same facts as the Telegram
 * message, as plain text plus a simple HTML table. Pure, so it is tested
 * without an SMTP server. Customer-supplied text is escaped in the HTML part.
 */
export function buildOrderMail(
  order: OrderNotification,
  adminUrl?: string,
): Omit<MailMessage, 'to'> {
  const payer = payerRows(order);
  const rows: Rows = [
    [payer.length ? 'Контактное лицо' : 'Покупатель', order.customerName],
    ['Телефон', order.customerPhone],
  ];
  if (order.customerEmail) rows.push(['E-mail', order.customerEmail]);
  rows.push(['Доставка', DELIVERY_LABELS[order.deliveryMethod]]);
  if (order.deliveryAddress) rows.push(['Адрес', order.deliveryAddress]);
  rows.push(['Оплата', PAYMENT_LABELS[order.paymentMethod]]);
  if (order.comment) rows.push(['Комментарий', order.comment]);

  const totals = totalRows(order);
  const link = adminUrl ? `${adminUrl}/admin/orders?order=${order.id}` : '';

  const text = [
    `Новый заказ №${order.number}`,
    '',
    ...textSection('Плательщик:', payer),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Состав заказа:',
    ...itemTextLines(order),
    '',
    ...totals.map(([k, v]) => `${k}: ${v}`),
    ...(link ? ['', link] : []),
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">Новый заказ №${order.number}</h2>
${htmlSection('Плательщик', payer)}${rowsTable(rows)}
${itemsTable(order)}
${rowsTable(totals, true)}${
    link
      ? `\n<p style="margin-top:16px"><a href="${escapeHtml(link)}">Открыть заказ в админке</a></p>`
      : ''
  }
</div>`;

  const who = order.payerName ? ` — ${order.payerName}` : '';
  return {
    subject: `Новый заказ №${order.number}${who} — ${money(order.total, order.currency)}`,
    text,
    html,
    // «Ответить» in the mail client writes straight to the customer.
    replyTo: order.customerEmail || undefined,
  };
}

/**
 * The confirmation the customer gets. A purchaser attaches it to the request
 * in their own accounting, so it carries the composition, the totals and the
 * payer exactly as recorded. Pure, like the shop's letter.
 */
export function buildCustomerOrderMail(
  order: OrderNotification,
  siteUrl?: string,
  invoiceUrl?: string,
): Omit<MailMessage, 'to'> {
  const payer = payerRows(order);
  const rows: Rows = [['Доставка', DELIVERY_LABELS[order.deliveryMethod]]];
  if (order.deliveryAddress) rows.push(['Адрес', order.deliveryAddress]);
  rows.push(['Оплата', PAYMENT_LABELS[order.paymentMethod]]);
  if (order.comment) rows.push(['Комментарий', order.comment]);

  const totals = totalRows(order);
  const next = invoiceUrl
    ? 'Счёт на оплату готов — скачайте его по ссылке ниже. Менеджер подтвердит наличие товара.'
    : order.paymentMethod === 'INVOICE'
      ? 'Менеджер проверит наличие и пришлёт счёт на оплату на этот адрес.'
      : 'Менеджер свяжется с вами, чтобы подтвердить заказ.';
  const link = siteUrl ? `${siteUrl}/account?tab=orders` : '';
  const site = siteUrl ? new URL(siteUrl).host : 'сайте';

  const text = [
    `Заказ №${order.number} принят`,
    '',
    next,
    ...(invoiceUrl ? [`Счёт (PDF): ${invoiceUrl}`] : []),
    '',
    ...textSection('Плательщик:', payer),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Состав заказа:',
    ...itemTextLines(order),
    '',
    ...totals.map(([k, v]) => `${k}: ${v}`),
    ...(link ? ['', `История заказов: ${link}`] : []),
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">Заказ №${order.number} принят</h2>
<p>${escapeHtml(next)}</p>${
    invoiceUrl
      ? `\n<p><a href="${escapeHtml(invoiceUrl)}" style="display:inline-block;padding:10px 18px;background:#e8590c;color:#fff;text-decoration:none;border-radius:6px">Скачать счёт (PDF)</a></p>`
      : ''
  }
${htmlSection('Плательщик', payer)}${rowsTable(rows)}
${itemsTable(order)}
${rowsTable(totals, true)}${
    link
      ? `\n<p style="margin-top:16px"><a href="${escapeHtml(link)}">Ваши заказы на ${escapeHtml(site)}</a></p>`
      : ''
  }
</div>`;

  return {
    subject: `Заказ №${order.number} принят — ${money(order.total, order.currency)}`,
    text,
    html,
  };
}
