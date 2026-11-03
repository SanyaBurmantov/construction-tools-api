import type { MailMessage } from './mail.service';
import {
  DELIVERY_LABELS,
  PAYMENT_LABELS,
  payerRows,
  type OrderNotification,
} from './telegram.service';
import {
  mailButton,
  mailButtons,
  mailItems,
  mailLayout,
  mailNote,
  mailRows,
  mailSection,
  mailTotals,
  money,
  type MailItem,
  type MailRow,
  type MailSeller,
} from './mail-layout';
import { escapeHtml } from './mail.service';

type Rows = Array<[string, string]>;

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

function textSection(title: string, rows: Rows): string[] {
  return rows.length ? [title, ...rows.map(([k, v]) => `${k}: ${v}`), ''] : [];
}

function mailLines(order: OrderNotification, siteUrl?: string): MailItem[] {
  return order.items.map((item) => ({
    name: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    href:
      siteUrl && item.productSlug
        ? `${siteUrl}/product/${item.productSlug}`
        : undefined,
    image: item.productImage,
  }));
}

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
const positions = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'позиция' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'позиции' : 'позиций'}`;

/**
 * The new-order letter to the shop's mailbox — the same facts as the Telegram
 * message: the customer's phone and e-mail are links, the button opens the
 * order in the admin. Pure, so it is tested without an SMTP server.
 */
export function buildOrderMail(
  order: OrderNotification,
  adminUrl?: string,
): Omit<MailMessage, 'to'> {
  const payer = payerRows(order);
  const contact: MailRow[] = [
    [payer.length ? 'Контактное лицо' : 'Покупатель', order.customerName],
    ['Телефон', order.customerPhone, tel(order.customerPhone)],
  ];
  if (order.customerEmail)
    contact.push([
      'E-mail',
      order.customerEmail,
      `mailto:${order.customerEmail}`,
    ]);
  const delivery: MailRow[] = [
    ['Доставка', DELIVERY_LABELS[order.deliveryMethod]],
  ];
  if (order.deliveryAddress) delivery.push(['Адрес', order.deliveryAddress]);
  delivery.push(['Оплата', PAYMENT_LABELS[order.paymentMethod]]);
  if (order.trafficSource) delivery.push(['Источник', order.trafficSource]);
  if (order.comment) delivery.push(['Комментарий', order.comment]);

  const totals = totalRows(order);
  const link = adminUrl ? `${adminUrl}/admin/orders?order=${order.id}` : '';
  const total = money(order.total, order.currency);

  const text = [
    `Новый заказ №${order.number}`,
    '',
    ...textSection('Плательщик:', payer),
    ...[...contact, ...delivery].map(([k, v]) => `${k}: ${v}`),
    '',
    'Состав заказа:',
    ...itemTextLines(order),
    '',
    ...totals.map(([k, v]) => `${k}: ${v}`),
    ...(link ? ['', link] : []),
  ].join('\n');

  const html = mailLayout({
    brand: { siteUrl: adminUrl },
    preheader: `${order.payerName || order.customerName}, ${order.customerPhone} — ${total}, ${positions(order.items.length)}`,
    badge: { text: 'Новый заказ', tone: 'brand' },
    title: `Заказ №${order.number} — ${total}`,
    intro: escapeHtml(
      `${PAYMENT_LABELS[order.paymentMethod]}, ${DELIVERY_LABELS[order.deliveryMethod].toLowerCase()}. ${positions(order.items.length)}.`,
    ),
    body: [
      link ? mailButton(link, 'Открыть заказ в админке') : '',
      payer.length ? mailSection('Плательщик', mailRows(payer)) : '',
      mailSection('Покупатель', mailRows(contact)),
      mailSection('Доставка и оплата', mailRows(delivery)),
      mailSection(
        'Состав заказа',
        mailItems(mailLines(order, adminUrl), order.currency),
      ),
      mailTotals(totals),
    ].join('\n'),
    footerNote: order.customerEmail
      ? '«Ответить» в почте напишет покупателю.'
      : undefined,
  });

  const who = order.payerName ? ` — ${order.payerName}` : '';
  return {
    subject: `Новый заказ №${order.number}${who} — ${total}`,
    text,
    html,
    // «Ответить» in the mail client writes straight to the customer.
    replyTo: order.customerEmail || undefined,
  };
}

/**
 * The confirmation the customer gets. A purchaser attaches it to the request
 * in their own accounting, so it carries the composition, the totals and the
 * payer exactly as recorded — in the storefront's look, with the seller's
 * requisites at the bottom. Pure, like the shop's letter.
 */
export function buildCustomerOrderMail(
  order: OrderNotification,
  siteUrl?: string,
  invoiceUrl?: string,
  seller?: Partial<MailSeller>,
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
  const total = money(order.total, order.currency);
  const phone = seller?.phone;

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

  const buttons = mailButtons([
    ...(invoiceUrl ? [{ href: invoiceUrl, label: 'Скачать счёт (PDF)' }] : []),
    ...(link
      ? [
          {
            href: link,
            label: 'Мои заказы',
            variant: invoiceUrl ? ('secondary' as const) : ('primary' as const),
          },
        ]
      : []),
  ]);

  const html = mailLayout({
    brand: { siteUrl, seller },
    preheader: `${next} Сумма заказа — ${total}.`,
    badge: { text: 'Заказ принят', tone: 'success' },
    title: `Спасибо! Заказ №${order.number} принят`,
    intro: mailNote(escapeHtml(next)),
    body: [
      buttons,
      mailSection(
        'Состав заказа',
        mailItems(mailLines(order, siteUrl), order.currency),
      ),
      mailTotals(totals),
      payer.length ? mailSection('Плательщик', mailRows(payer)) : '',
      mailSection('Доставка и оплата', mailRows(rows)),
    ].join('\n'),
    footerNote: `Вопрос по заказу — ответьте на это письмо${
      phone
        ? ` или позвоните <a href="${tel(phone)}" style="color:#667085;white-space:nowrap">${escapeHtml(phone)}</a>`
        : ''
    }.`,
  });

  return {
    subject: `Заказ №${order.number} принят — ${total}`,
    text,
    html,
  };
}
