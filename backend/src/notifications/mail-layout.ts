import { escapeHtml } from './mail.service';
import { SELLER_DEFAULTS } from '../b2b/seller.service';
import { variantUrlFor } from '../media/variant-url';

/**
 * The look of every letter gost.by sends — the storefront's palette, type
 * and logo (frontend `assets/scss/tokens.scss`, `components/brandLogo.vue`)
 * in the only markup mail clients agree on: nested tables, inline styles,
 * 600 px wide. Gmail and Outlook drop `<style>` blocks or most of them, so
 * nothing here depends on one; the block in <head> only adds Manrope where a
 * client loads web fonts (Apple Mail, iOS) and tighter padding on phones.
 *
 * Pure string builders: the letters are tested without SMTP, and every value
 * that came from a customer goes through `escapeHtml` before it gets here or
 * here.
 */

/** tokens.scss, flattened: mail clients know no CSS variables. */
export const MAIL_COLORS = {
  page: '#f2f4f7',
  card: '#ffffff',
  sunken: '#f9fafb',
  border: '#e4e7ec',
  text: '#1d2939',
  strong: '#101828',
  muted: '#667085',
  brand: '#1d4ed8',
  brandSoft: '#eff6ff',
  brandSoftText: '#1e40af',
  success: '#039855',
  successSoft: '#ecfdf3',
  successSoftText: '#027a48',
} as const;

const FONT = "Manrope,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const C = MAIL_COLORS;

export type MailSeller = {
  name: string;
  unp: string;
  phone: string;
  email: string;
};

export type MailBrand = {
  /** `https://gost.by` — links, the logo and the web font hang off it. */
  siteUrl?: string;
  /** The footer's requisites; the seller settings' defaults when omitted. */
  seller?: Partial<MailSeller>;
};

export type MailBadge = {
  text: string;
  tone?: 'brand' | 'success' | 'neutral';
};

export type MailLayoutInput = {
  brand: MailBrand;
  /** Inbox preview line, hidden in the letter itself. Plain text. */
  preheader: string;
  badge?: MailBadge;
  /** Plain text, escaped here. */
  title: string;
  /** Ready HTML (escape customer text before passing it). */
  intro?: string;
  /** Ready HTML: the blocks built with the helpers below. */
  body: string;
  /** Ready HTML under the card, above the requisites. */
  footerNote?: string;
};

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** A whole letter: page, header with the logo, the card, the footer. */
export function mailLayout(input: MailLayoutInput): string {
  const site = input.brand.siteUrl?.replace(/\/+$/, '');
  const seller: MailSeller = { ...pickSeller(), ...clean(input.brand.seller) };
  const host = site ? new URL(site).host : 'gost.by';
  const fontFace = site
    ? `@font-face{font-family:Manrope;font-weight:400 800;font-display:swap;src:url(${site}/fonts/manrope-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Manrope;font-weight:400 800;font-display:swap;src:url(${site}/fonts/manrope-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+2013-2026,U+20AC,U+2212}`
    : '';

  // The mark is the site's icon on its own blue: with images blocked the
  // square still reads as the logo.
  const mark = site
    ? `<img src="${site}/apple-touch-icon.png" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;border-radius:8px;background:${C.brand}">`
    : `<div style="width:32px;height:32px;border-radius:8px;background:${C.brand}"></div>`;
  const logo = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0 10px 0 0;vertical-align:middle">${link(site, mark)}</td>
<td style="vertical-align:middle;font-family:${FONT};font-size:20px;line-height:24px;font-weight:800;letter-spacing:-0.5px;color:${C.strong}">${link(site, 'Gost.by', `color:${C.strong};text-decoration:none`)}</td>
</tr></table>`;

  const requisites = [
    escapeHtml(seller.name),
    seller.unp ? `УНП ${escapeHtml(seller.unp)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const contacts = [
    seller.phone
      ? `<a href="${telHref(seller.phone)}" style="color:${C.muted};text-decoration:none;white-space:nowrap">${escapeHtml(seller.phone)}</a>`
      : '',
    seller.email
      ? `<a href="mailto:${escapeHtml(seller.email)}" style="color:${C.muted};text-decoration:none">${escapeHtml(seller.email)}</a>`
      : '',
    site
      ? `<a href="${site}" style="color:${C.muted};text-decoration:none">${escapeHtml(host)}</a>`
      : '',
  ]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  return `<!doctype html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.title)}</title>
<style>
${fontFace}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
a{color:${C.brand}}
@media (max-width:620px){
.mail-card{padding:24px 20px!important}
.mail-outer{padding:16px 8px!important}
.mail-title{font-size:22px!important;line-height:28px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(input.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
<tr><td align="center" class="mail-outer" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="padding:0 4px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle">${logo}</td>
<td align="right" style="vertical-align:middle;font-family:${FONT};font-size:12px;line-height:16px;color:${C.muted}">Инструмент и&nbsp;крепёж<br>для&nbsp;бизнеса и&nbsp;мастеров</td>
</tr></table>
</td></tr>
<tr><td class="mail-card" style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:32px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.text}">
${input.badge ? badge(input.badge) : ''}
<h1 class="mail-title" style="margin:0 0 12px;font-family:${FONT};font-size:26px;line-height:32px;font-weight:800;letter-spacing:-0.5px;color:${C.strong}">${escapeHtml(input.title)}</h1>
${input.intro ? `<div style="margin:0 0 24px;color:${C.text}">${input.intro}</div>` : ''}
${input.body}
</td></tr>
<tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}" align="center">
${input.footerNote ? `<div style="margin:0 0 12px">${input.footerNote}</div>` : ''}
<div>${requisites}</div>
${contacts ? `<div style="margin-top:4px">${contacts}</div>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function pickSeller(): MailSeller {
  const { name, unp, phone, email } = SELLER_DEFAULTS;
  return { name, unp, phone, email };
}

/** Drops blank fields so a half-filled settings row keeps the defaults. */
function clean(seller?: Partial<MailSeller>): Partial<MailSeller> {
  if (!seller) return {};
  return Object.fromEntries(
    Object.entries(seller).filter(
      ([, v]) => typeof v === 'string' && v.trim() !== '',
    ),
  );
}

function link(href: string | undefined, html: string, style = '') {
  return href
    ? `<a href="${escapeHtml(href)}" style="${style || 'text-decoration:none'}">${html}</a>`
    : html;
}

function badge({ text, tone = 'brand' }: MailBadge): string {
  const [bg, fg] =
    tone === 'success'
      ? [C.successSoft, C.successSoftText]
      : tone === 'neutral'
        ? [C.sunken, C.muted]
        : [C.brandSoft, C.brandSoftText];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr><td style="background:${bg};color:${fg};border-radius:999px;padding:4px 12px;font-family:${FONT};font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase">${escapeHtml(text)}</td></tr></table>`;
}

/**
 * The «bulletproof» button: a link padded inside a coloured cell, so it is a
 * button in Outlook too. `secondary` is the outlined one.
 */
export function mailButton(
  href: string,
  label: string,
  variant: 'primary' | 'secondary' = 'primary',
): string {
  return mailButtons([{ href, label, variant }]);
}

/**
 * Buttons in one row that wraps on a phone: each one an inline-block table,
 * which Outlook lays out side by side and narrow clients stack.
 */
export function mailButtons(
  buttons: Array<{
    href: string;
    label: string;
    variant?: 'primary' | 'secondary';
  }>,
): string {
  if (!buttons.length) return '';
  const cells = buttons.map(({ href, label, variant = 'primary' }) => {
    const primary = variant === 'primary';
    const bg = primary ? C.brand : C.card;
    const fg = primary ? '#ffffff' : C.brand;
    const border = primary ? C.brand : C.border;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 8px 0;vertical-align:top"><tr><td style="background:${bg};border:1px solid ${border};border-radius:12px">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${fg};text-decoration:none;border-radius:12px;white-space:nowrap">${escapeHtml(label)}</a>
</td></tr></table>`;
  });
  return `<div style="margin:0 0 16px">${cells.join('')}</div>`;
}

/** A block with a small heading. `html` is ready markup. */
export function mailSection(title: string, html: string): string {
  if (!html) return '';
  return `<div style="margin:0 0 24px">
<div style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;color:${C.muted}">${escapeHtml(title)}</div>
${html}
</div>`;
}

/** [label, value, href?] — the value is plain text, escaped here. */
export type MailRow = [string, string, string?];

/** Label/value pairs in a light box; a row with an href is a link (tel:, mailto:…). */
export function mailRows(rows: MailRow[]): string {
  if (!rows.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.sunken};border:1px solid ${C.border};border-radius:12px;border-collapse:separate">
${rows
  .map(([label, value, href], i) => {
    const top = i === 0 ? '' : `border-top:1px solid ${C.border};`;
    const shown = escapeHtml(value).replace(/\n/g, '<br>');
    const cell = href
      ? `<a href="${escapeHtml(href)}" style="color:${C.brand};text-decoration:none">${shown}</a>`
      : shown;
    return `<tr>
<td valign="top" style="${top}padding:10px 8px 10px 16px;width:38%;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted}">${escapeHtml(label)}</td>
<td valign="top" style="${top}padding:10px 16px 10px 8px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.strong};word-break:break-word">${cell}</td>
</tr>`;
  })
  .join('')}
</table>`;
}

export type MailItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Product page; the name links to it. */
  href?: string;
  /** Photo URL; our stored copies are taken at the thumbnail size. */
  image?: string | null;
};

const formatters = new Map<string, Intl.NumberFormat>();

/** The storefront's price format (`useFormatPrice`): «1 234,50 Br». */
export function money(value: number, currency: string): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'BYN';
  let formatter = formatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-BY', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    });
    formatters.set(code, formatter);
  }
  // Narrow no-break spaces keep «1 234,50 Br» on one line; plain ones here,
  // the HTML helpers put &nbsp; back where a wrap would hurt.
  return formatter.format(value).replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * Order lines as the cart shows them: photo, name, «2 × 10,00», sum on the
 * right. Three columns that hold on a phone, so no media query is needed.
 */
export function mailItems(items: MailItem[], currency: string): string {
  if (!items.length) return '';
  const nb = (s: string) => s.replace(/ /g, '&nbsp;');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${items
  .map((item, i) => {
    const top = i === 0 ? '' : `border-top:1px solid ${C.border};`;
    const src = item.image ? thumbUrl(item.image) : null;
    const photo = src
      ? `<img src="${escapeHtml(src)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:contain;border:1px solid ${C.border};border-radius:8px;background:#fff">`
      : `<div style="width:56px;height:56px;border-radius:8px;background:${C.sunken};border:1px solid ${C.border}"></div>`;
    const name = escapeHtml(item.name);
    return `<tr>
<td valign="top" style="${top}padding:12px 12px 12px 0;width:58px">${item.href ? link(item.href, photo) : photo}</td>
<td valign="top" style="${top}padding:12px 12px 12px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.strong}">
${item.href ? `<a href="${escapeHtml(item.href)}" style="color:${C.strong};text-decoration:none;font-weight:600">${name}</a>` : `<span style="font-weight:600">${name}</span>`}
<div style="margin-top:4px;color:${C.muted};font-size:13px">${item.quantity}&nbsp;×&nbsp;${nb(money(item.unitPrice, currency))}</div>
</td>
<td valign="top" align="right" style="${top}padding:12px 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;color:${C.strong};white-space:nowrap">${nb(money(item.lineTotal, currency))}</td>
</tr>`;
  })
  .join('')}
</table>`;
}

/**
 * Totals under the lines; the last row is the grand total, set large in the
 * brand colour like the cart's.
 */
export function mailTotals(rows: Array<[string, string]>): string {
  if (!rows.length) return '';
  const last = rows.length - 1;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${C.strong};margin:0 0 24px">
${rows
  .map(([label, value], i) => {
    const total = i === last;
    const pad = total ? '14px 0 0' : i === 0 ? '12px 0 4px' : '4px 0';
    const size = total
      ? 'font-size:18px;line-height:24px;font-weight:800'
      : 'font-size:14px;line-height:20px';
    return `<tr>
<td style="padding:${pad};font-family:${FONT};${size};color:${total ? C.strong : C.muted}">${escapeHtml(label)}</td>
<td align="right" style="padding:${pad};font-family:${FONT};${size};color:${total ? C.brand : C.strong};white-space:nowrap">${escapeHtml(value).replace(/ /g, '&nbsp;')}</td>
</tr>`;
  })
  .join('')}
</table>`;
}

/** A soft blue box for «what happens next». `html` is ready markup. */
export function mailNote(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td style="background:${C.brandSoft};border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${C.brandSoftText}">${html}</td></tr></table>`;
}

/** Plain paragraph in the muted colour (small print inside the card). */
export function mailSmall(html: string): string {
  return `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${html}</p>`;
}

/** Our stored photo at thumbnail size; any other URL as is (http(s) only). */
function thumbUrl(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  return variantUrlFor(url, 112);
}
