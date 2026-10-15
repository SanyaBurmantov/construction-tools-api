/**
 * Strips a supplier's own storefront boilerplate out of product text.
 *
 * dukon.by publishes, as the meta description of every product, «Купить <name>
 * в Минске с гарантией и доставкой. Лучшие цены от ведущих производителей ➢
 * Звоните, наши специалисты ответят на все интересующие вопросы ☎ +375 (29)
 * 668-00-11», and its <title> ends in «купить в Минске». Copied as-is that put
 * a competitor's phone number and the wrong city on our product pages, in
 * their meta description and in the JSON-LD.
 *
 * Deliberately conservative: text with none of the markers below is returned
 * untouched (whitespace and line breaks included), and what is removed is a
 * whole *marketing* sentence or a phone number — never a word out of a
 * technical sentence. «гарантирует высокую прочность» stays; «в Минске» on its
 * own stays; only «купить/заказать … в Минске», «с гарантией и доставкой»,
 * «Звоните…», «Лучшие цены…» and phone numbers go.
 *
 * Pure and dependency-free: used at import (ProductIdentityService) and by the
 * one-off backfill of rows imported before this existed.
 */

/** A Belarusian phone: +375 (29) 668-00-11, 375 29 6680011, 8 (029) 668-00-11. */
const PHONE_SOURCE =
  '(?<![\\d+])(?:\\+\\s?375|375(?=[\\s(-]))[\\s\\-()]*\\d{2}[\\s\\-()]*\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}(?!\\d)' +
  '|(?<!\\d)8\\s*\\(0\\d{2}\\)\\s*\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}(?!\\d)';

/** The number together with a «тел.:» / «☎» in front of it. */
const PHONE = new RegExp(
  `(?:(?<!\\p{L})тел(?:ефон)?\\.?\\s*:?\\s*)?[☎📞]?\\s*(?:${PHONE_SOURCE})`,
  'giu',
);

const CTA_GLYPHS = /[☎➢📞►✔✅]/gu;

/** Cities a supplier advertises itself in. Our shop is elsewhere (Витебск). */
const SUPPLIER_CITY =
  /(?<!\p{L})в\s+(?:г\.\s*)?(?:Минске|Мниске|Беларуси)(?!\p{L})/iu;

const BUY =
  /(?<!\p{L})(?:купить|заказать|приобрести|покупайте|закажите)(?!\p{L})/iu;

const MARKETING_SENTENCE: RegExp[] = [
  /(?<!\p{L})(?:По)?звоните(?!\p{L})/iu,
  /(?<!\p{L})лучшие\s+цены(?!\p{L})/iu,
  /наши\s+(?:специалисты|менеджеры|консультанты)\s+ответят/iu,
  /(?<!\p{L})с\s+гарантией\s+и\s+доставкой(?!\p{L})/iu,
];

/** Cheap gate: nothing here means the text is returned byte-for-byte. */
const ANY_MARKER =
  /[☎➢📞]|\+\s?375|(?<!\d)375[\s(-]\d|(?<!\d)8\s*\(0\d{2}\)|звоните|лучшие\s+цены|с\s+гарантией\s+и\s+доставкой|в\s+(?:г\.\s*)?(?:минске|мниске|беларуси)/iu;

/**
 * Splits before a capitalised word that follows sentence punctuation, and
 * before a CTA glyph. A period inside a size («d4.5 мм») or an abbreviation
 * followed by lower case («15 пр. ударных») is not a boundary.
 */
const BOUNDARY = /((?<=[.!?])\s+(?=[\p{Lu}\d«"])|\s*(?=[☎➢📞]))/u;

const HAS_CONTENT = /[\p{L}\d]/u;

function isMarketing(sentence: string) {
  if (MARKETING_SENTENCE.some((re) => re.test(sentence))) return true;
  return BUY.test(sentence) && SUPPLIER_CITY.test(sentence);
}

/**
 * Removes supplier marketing sentences and phone numbers. Returns '' when
 * nothing of substance is left (the whole field was boilerplate).
 */
export function sanitizeSupplierText(text: string | null | undefined): string {
  if (!text) return '';
  if (!ANY_MARKER.test(text)) return text;

  const parts = text.split(BOUNDARY);
  const kept: string[] = [];
  // split() with a capture group alternates [piece, separator, piece, …].
  for (let i = 0; i < parts.length; i += 2) {
    const separator = i > 0 ? parts[i - 1] : '';
    let piece = parts[i];
    if (isMarketing(piece)) continue;

    piece = piece
      .replace(PHONE, '')
      .replace(CTA_GLYPHS, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/[\s,;:–—-]+$/u, '');
    if (!HAS_CONTENT.test(piece)) continue;

    kept.push(kept.length ? separator || ' ' : '', piece);
  }

  return kept.join('').trim();
}

const TITLE_TAIL =
  /\s*[,–—|-]?\s*(?:купить|заказать)\s+(?:в\s+(?:г\.\s*)?(?:Минске|Мниске|Беларуси)|недорого)(?:\s+(?:с\s+гарантией|с\s+доставкой|недорого)[\p{L}\s]*)?\s*$/iu;

/**
 * A supplier SEO title: «<name> купить в Минске». Returns the title with the
 * tail removed, or '' if it was only the tail.
 */
export function sanitizeSupplierTitle(
  title: string | null | undefined,
): string {
  if (!title) return '';
  return title.replace(TITLE_TAIL, '').replace(PHONE, '').trim();
}

/** Cut at a word boundary so a description never ends «в трудно». */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:–—-]+$/u, '')}…`;
}

export type ProductTextFields = {
  name?: string | null;
  descriptionShort?: string | null;
  descriptionFull?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

const SHORT_MAX = 240;

/**
 * Cleans the four text fields of a product and returns **only the ones that
 * changed**, so it can be spread into an update without touching the rest.
 *
 * When a field was nothing but boilerplate it falls back the way the parsers
 * build it: short ← start of the full description, SEO description ← short ←
 * name, SEO title ← name. A field that was absent stays absent.
 */
export function cleanProductTexts(
  fields: ProductTextFields,
): Partial<Record<Exclude<keyof ProductTextFields, 'name'>, string | null>> {
  const patch: Partial<
    Record<Exclude<keyof ProductTextFields, 'name'>, string | null>
  > = {};
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';

  const full =
    typeof fields.descriptionFull === 'string'
      ? sanitizeSupplierText(fields.descriptionFull)
      : undefined;
  if (full !== undefined && full !== fields.descriptionFull)
    patch.descriptionFull = full || null;

  let short: string | undefined;
  if (typeof fields.descriptionShort === 'string') {
    short = sanitizeSupplierText(fields.descriptionShort);
    if (short !== fields.descriptionShort) {
      if (!short && full) short = truncateAtWord(full, SHORT_MAX);
      patch.descriptionShort = short || null;
    }
  }

  if (typeof fields.seoDescription === 'string') {
    const seo = sanitizeSupplierText(fields.seoDescription);
    if (seo !== fields.seoDescription)
      patch.seoDescription =
        seo ||
        short ||
        (full ? truncateAtWord(full, SHORT_MAX) : '') ||
        name ||
        null;
  }

  if (typeof fields.seoTitle === 'string') {
    const title = sanitizeSupplierTitle(fields.seoTitle);
    // «Головку торцевую ударную X купить в Минске» is in the accusative for the
    // dropped verb — the product name reads better than what is left.
    if (title !== fields.seoTitle) patch.seoTitle = name || title || null;
  }

  return patch;
}
