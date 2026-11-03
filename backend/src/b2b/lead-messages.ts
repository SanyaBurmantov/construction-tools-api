import type { MailMessage } from '../notifications/mail.service';
import {
  mailButton,
  mailLayout,
  mailRows,
  mailSection,
  money,
  type MailRow,
} from '../notifications/mail-layout';

/** What a manager needs to call a lead back — shared by Telegram and mail. */
export type LeadNotice = {
  id: string;
  number: number;
  kind: 'QUOTE' | 'QUESTION';
  companyName: string | null;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  productName: string | null;
  productSlug: string | null;
  total: number | null;
  currency: string | null;
  items: Array<{ name: string; quantity: number; lineTotal: number }> | null;
  trafficSource?: string | null;
};

const KIND_TITLE: Record<LeadNotice['kind'], string> = {
  QUOTE: 'Скачано коммерческое предложение',
  QUESTION: 'Вопрос с сайта',
};

/** Label/value rows, without the items. Pure. */
export function leadRows(lead: LeadNotice): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (lead.companyName) rows.push(['Организация', lead.companyName]);
  if (lead.taxId) rows.push(['УНП', lead.taxId]);
  if (lead.contactName) rows.push(['Контакт', lead.contactName]);
  if (lead.phone) rows.push(['Телефон', lead.phone]);
  if (lead.email) rows.push(['E-mail', lead.email]);
  if (lead.productName) rows.push(['Товар', lead.productName]);
  if (lead.message) rows.push(['Сообщение', lead.message]);
  if (lead.total != null)
    rows.push(['Сумма', money(lead.total, lead.currency ?? 'BYN')]);
  if (lead.trafficSource) rows.push(['Источник', lead.trafficSource]);
  return rows;
}

const ITEMS_IN_MESSAGE = 15;

function itemLines(lead: LeadNotice): string[] {
  if (!lead.items?.length) return [];
  const shown = lead.items
    .slice(0, ITEMS_IN_MESSAGE)
    .map((item) => `• ${item.name} — ${item.quantity} шт.`);
  const rest = lead.items.length - ITEMS_IN_MESSAGE;
  if (rest > 0) shown.push(`…и ещё ${rest} поз.`);
  return shown;
}

const escapeTelegram = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram HTML. Visitor text is escaped. */
export function buildLeadTelegram(lead: LeadNotice, origin?: string): string {
  const lines = [`📨 <b>${KIND_TITLE[lead.kind]} №${lead.number}</b>`, ''];
  for (const [label, value] of leadRows(lead)) {
    lines.push(`<b>${label}:</b> ${escapeTelegram(value.slice(0, 800))}`);
  }
  const items = itemLines(lead);
  if (items.length) lines.push('', ...items.map(escapeTelegram));
  if (origin && lead.productSlug) {
    lines.push('', `${origin}/product/${lead.productSlug}`);
  }
  if (origin) lines.push(`${origin}/admin/leads`);
  return lines.join('\n');
}

/** The letter to MAIL_ADMIN_TO; replying writes to the visitor. */
export function buildLeadMail(
  lead: LeadNotice,
  origin?: string,
): Omit<MailMessage, 'to'> {
  const rows = leadRows(lead);
  const items = itemLines(lead);
  const title = `${KIND_TITLE[lead.kind]} №${lead.number}`;
  const text = [
    title,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(items.length ? ['', ...items] : []),
    ...(origin ? ['', `${origin}/admin/leads`] : []),
  ].join('\n');
  // Phone and e-mail are links: the manager calls back from the letter.
  const linked: MailRow[] = rows.map(([k, v]) =>
    k === 'Телефон'
      ? [k, v, `tel:${v.replace(/[^\d+]/g, '')}`]
      : k === 'E-mail'
        ? [k, v, `mailto:${v}`]
        : k === 'Товар' && origin && lead.productSlug
          ? [k, v, `${origin}/product/${lead.productSlug}`]
          : [k, v],
  );
  const itemsHtml = items.length
    ? mailRows(
        items.map((line): MailRow => {
          const text = line.replace(/^• /, '');
          const at = text.lastIndexOf(' — ');
          return at > 0 ? [text.slice(0, at), text.slice(at + 3)] : [text, ''];
        }),
      )
    : '';
  const html = mailLayout({
    brand: { siteUrl: origin },
    preheader: [lead.companyName, lead.contactName, lead.phone]
      .filter(Boolean)
      .join(', '),
    badge: {
      text: lead.kind === 'QUOTE' ? 'Коммерческое предложение' : 'Вопрос',
      tone: 'brand',
    },
    title: `Заявка №${lead.number}`,
    intro:
      lead.kind === 'QUOTE'
        ? 'Посетитель скачал коммерческое предложение — хороший момент позвонить.'
        : 'Посетитель просит уточнить наличие или подобрать аналог.',
    body: [
      origin ? mailButton(`${origin}/admin/leads`, 'Заявки в админке') : '',
      mailSection('Контакт', mailRows(linked)),
      itemsHtml ? mailSection('Позиции', itemsHtml) : '',
    ].join('\n'),
    footerNote: lead.email
      ? '«Ответить» в почте напишет посетителю.'
      : undefined,
  });
  const who = lead.companyName || lead.contactName || lead.phone || '';
  return {
    subject: `${title}${who ? ` — ${who}` : ''}`,
    text,
    html,
    replyTo: lead.email || undefined,
  };
}
