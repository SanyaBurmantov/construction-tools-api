import * as cheerio from 'cheerio';

/**
 * The text a reader of a page actually reads — what a detector should judge.
 *
 * Menus, footers, cookie banners and product carousels are not the page's
 * copy, and on a shop page they outweigh it. Order of preference: an
 * explicit description (`itemprop=description`, our own product page's
 * «Описание» panel), then `<article>` / `<main>`, then the element with the
 * most paragraph text of its own. Pure (HTML in, text out), so it is tested
 * against fixtures without a network.
 */
export type PageText = { title: string | null; text: string; picked: string };

const NOISE =
  'script, style, noscript, template, svg, iframe, form, nav, header, footer, aside, ' +
  '[role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], ' +
  '.breadcrumbs, .breadcrumb, .cookie, .menu, .footer, .header';

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'th',
  'tr',
  'ul',
]);
const MIN_PICK_CHARS = 200;

type Node = { type: string; name?: string; data?: string; children?: Node[] };

/**
 * The text of an element with its block structure kept: every block-level
 * element is its own paragraph. Shops put descriptions straight into a
 * `<div>` (th-tool.by's `.desc`), so reading only `<p>` lost them.
 */
function readable(root: cheerio.Cheerio<any>): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.type === 'text') {
      out.push(node.data ?? '');
      return;
    }
    if (node.type !== 'tag') return;
    const block = BLOCK_TAGS.has(node.name ?? '');
    if (block) out.push('\n');
    node.children?.forEach(walk);
    if (block) out.push('\n');
  };
  root.toArray().forEach((el) => walk(el as Node));
  return out.join('').split(/\n+/).map(clean).filter(Boolean).join('\n\n');
}

/** Characters of text an element holds itself (text and inline children). */
function ownTextLength($: cheerio.CheerioAPI, el: Node): number {
  let length = 0;
  for (const child of el.children ?? []) {
    if (child.type === 'text') length += clean(child.data ?? '').length;
    else if (child.type === 'tag' && !BLOCK_TAGS.has(child.name ?? '')) {
      length += clean($(child as any).text()).length;
    } else if (child.name === 'p') {
      length += clean($(child as any).text()).length;
    }
  }
  return length;
}

function clean(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractPageText(html: string): PageText {
  const $ = cheerio.load(html);
  const title =
    clean($('meta[property="og:title"]').attr('content') ?? '') ||
    clean($('title').first().text()) ||
    null;
  $(NOISE).remove();

  const candidates: Array<[string, cheerio.Cheerio<any>]> = [
    ['описание товара', $('[itemprop="description"]').first()],
    [
      'описание товара',
      $('.product-description, #description, .description').first(),
    ],
    ['статья', $('article').first()],
    ['основная часть', $('main, [role=main]').first()],
  ];
  for (const [picked, el] of candidates) {
    if (!el.length) continue;
    const text = readable(el);
    if (text.length >= MIN_PICK_CHARS) return { title, text, picked };
  }

  // The element holding the most text of its own (its paragraphs count).
  let best: cheerio.Cheerio<any> | null = null;
  let bestScore = 0;
  $('body *').each((_, el) => {
    const own = ownTextLength($, el as Node);
    if (own > bestScore) {
      bestScore = own;
      best = $(el);
    }
  });
  if (best && bestScore >= MIN_PICK_CHARS) {
    return {
      title,
      text: readable(best),
      picked: 'самый большой блок текста',
    };
  }
  return { title, text: readable($('body')), picked: 'вся страница' };
}
