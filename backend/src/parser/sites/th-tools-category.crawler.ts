import * as cheerio from 'cheerio';
import { isThToolsProductUrl } from '../sitemaps/sitemaps.service';

export const TH_TOOLS_BASE_URL = 'https://th-tool.by';

/**
 * A th-tool.by category page. Product links are plain one-segment paths
 * (`/avtolampa-h7-55-px26d-12v/`), the same shape the sitemap uses — so the
 * queue filter (`isThToolsProductUrl`) is the only selector we depend on.
 * Deliberately *not* keyed off CSS classes: the shop is a Webasyst theme and
 * its markup classes churn, while the URL shape does not.
 */
export function parseThToolsCategoryPage(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const base = safeUrl(pageUrl) ?? new URL(TH_TOOLS_BASE_URL);

  const productUrls = new Set<string>();
  const categoryUrls = new Set<string>();
  const pageNumbers = new Set<number>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    const url = safeUrl(href, base);
    if (!url || url.hostname !== base.hostname) return;

    if (isThToolsProductUrl(url.toString())) {
      // Strip query/hash so `/x/?sort=price` and `/x/` are one queue row.
      productUrls.add(`${url.origin}${url.pathname}`);
      return;
    }

    if (isThToolsCategoryUrl(url.toString())) {
      categoryUrls.add(`${url.origin}${url.pathname}`);
    }

    if (url.pathname === base.pathname) {
      const page = Number(url.searchParams.get('page'));
      if (Number.isInteger(page) && page > 0) pageNumbers.add(page);
    }
  });

  return {
    name: $('h1.category-name').first().text().trim() || undefined,
    productUrls: [...productUrls],
    categoryUrls: [...categoryUrls],
    /** Page numbers linked from this page — the pager only shows a window. */
    maxLinkedPage: pageNumbers.size ? Math.max(...pageNumbers) : 1,
  };
}

/** `https://th-tool.by/category/aksessuary/avtolampy/` → true. */
export function isThToolsCategoryUrl(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) return false;

  const segments = parsed.pathname.split('/').filter(Boolean);
  return segments.length >= 2 && segments[0] === 'category';
}

/** Slug chain below `/category/`, used to render the queue as a tree. */
export function thToolsCategoryPath(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) return [];
  return parsed.pathname.split('/').filter(Boolean).slice(1);
}

/** Human-readable fallback name when we have not crawled the page yet. */
export function thToolsCategoryName(url: string) {
  const path = thToolsCategoryPath(url);
  const last = path[path.length - 1] ?? '';
  return last.replace(/-/g, ' ').trim() || url;
}

export function thToolsCategoryPageUrl(url: string, page: number) {
  const parsed = safeUrl(url);
  if (!parsed) return url;
  if (page > 1) parsed.searchParams.set('page', String(page));
  return parsed.toString();
}

function safeUrl(value: string, base?: URL) {
  try {
    return new URL(value, base ?? TH_TOOLS_BASE_URL);
  } catch {
    return undefined;
  }
}
