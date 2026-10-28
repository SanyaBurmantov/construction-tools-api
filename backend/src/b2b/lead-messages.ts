import type { MailMessage } from '../notifications/mail.service';
import { escapeHtml } from '../notifications/mail.service';

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
    rows.push(['Сумма', `${lead.total.toFixed(2)} ${lead.currency ?? 'BYN'}`]);
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
  const cell = 'padding:4px 8px;border-bottom:1px solid #eee;';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
<table style="border-collapse:collapse;margin-bottom:16px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="${cell}color:#666">${escapeHtml(k)}</td><td style="${cell}">${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>${
    items.length
      ? `<ul>${items.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join('')}</ul>`
      : ''
  }${origin ? `<p><a href="${escapeHtml(origin)}/admin/leads">Заявки в админке</a></p>` : ''}
</div>`;
  const who = lead.companyName || lead.contactName || lead.phone || '';
  return {
    subject: `${title}${who ? ` — ${who}` : ''}`,
    text,
    html,
    replyTo: lead.email || undefined,
  };
}
