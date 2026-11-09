import * as cheerio from 'cheerio';
import { stemRu } from './stem-ru';

/**
 * «Где этот текст у конкурентов»: we ask each competitor's own site search for
 * the product, open the cards it lists and compare their text with ours. Free
 * and without a search engine; the price is one search page and up to two
 * cards per site for each check a person starts.
 *
 * Pure parts only (the query, the links worth opening); fetching is the
 * service's job.
 */

export type Competitor = {
  name: string;
  /** Search address with `{q}` where the query goes. */
  search: string;
};

/**
 * Checked from the prod server on 2026-11-09: both answer our honest user
 * agent and carry the suppliers' texts word for word (WORTEX CRH 1810: 21vek's
 * card and shop.by's both repeat tools.by's description). mile.by answers 403,
 * Onliner shows its own spec summary, not a text; ozon/wildberries need JS.
 */
export const DEFAULT_COMPETITORS: Competitor[] = [
  { name: '21vek.by', search: 'https://www.21vek.by/search/?term={q}' },
  { name: 'shop.by', search: 'https://shop.by/find/?findtext={q}' },
];

export const MAX_COMPETITORS = 10;
export const CARDS_PER_COMPETITOR = 2;

/** Parses the admin's list: one `name https://…{q}…` or bare address per line. */
export function parseCompetitors(raw: string): Competitor[] {
  const out: Competitor[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /(https?:\/\/\S+)/.exec(trimmed);
    if (!match) throw new Error(`Нет адреса в строке «${trimmed}»`);
    const search = match[1];
    if (!search.includes('{q}')) {
      throw new Error(`В адресе нет {q} — куда подставить товар: ${search}`);
    }
    let host: string;
    try {
      host = new URL(search.replace('{q}', 'x')).hostname.replace(/^www\./, '');
    } catch {
      throw new Error(`Не адрес: ${search}`);
    }
    const name = trimmed.replace(search, '').trim() || host;
    out.push({ name, search });
  }
  if (out.length > MAX_COMPETITORS) {
    throw new Error(`Не больше ${MAX_COMPETITORS} сайтов`);
  }
  return out;
}

export function formatCompetitors(list: Competitor[]): string {
  return list.map((c) => `${c.name} ${c.search}`).join('\n');
}

export type CompetitorQuery = {
  /** What is typed into the shop's search. */
  query: string;
  /** Model codes a card must carry (normalised: «crh1810»). */
  codes: string[];
  /** Stems of the name's words, for names without a model code. */
  stems: string[];
};

const LATIN_OR_DIGIT = /^(?=.*[a-z0-9])[a-z0-9.,/×x*-]+$/i;

/** Lower case, ё→е, letters and digits only: «CRH 1810» and «crh-1810» meet. */
export function squash(text: string) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The query for a product: brand + its model code when the name has one
 * («WORTEX CRH 1810»), else the start of the name. A supplier's internal
 * article in brackets is left out — no other shop knows it.
 */
export function competitorQuery(
  name: string,
  brand?: string | null,
): CompetitorQuery | null {
  const clean = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  const tokens = clean.split(' ');
  const brandSquashed = brand ? squash(brand) : '';
  // Runs of adjacent Latin/digit tokens are one model code: «CRH 1810».
  const runs: string[][] = [[]];
  for (const token of tokens) {
    const bare = token.replace(/^[«"(]+|[»"),;:]+$/g, '');
    if (bare && LATIN_OR_DIGIT.test(bare) && squash(bare) !== brandSquashed) {
      runs[runs.length - 1].push(bare);
    } else if (runs[runs.length - 1].length) {
      runs.push([]);
    }
  }
  const codeRun = runs.find(
    (r) => /\d/.test(r.join('')) && squash(r.join('')).length >= 3,
  );

  const stems = clean
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && /\p{L}/u.test(w))
    .map(stemRu);

  if (codeRun) {
    // Up to the first token with a digit: «CRH 1810», not our supplier's
    // «ALL1 SOLO» (shops' searches are strict about extras). The code a card
    // must carry is that token with the one before it.
    const digitAt = codeRun.findIndex((t) => /\d/.test(t));
    const query = [brand?.trim(), ...codeRun.slice(0, digitAt + 1)]
      .filter(Boolean)
      .join(' ');
    const code = codeRun.slice(Math.max(0, digitAt - 1), digitAt + 1);
    return { query, codes: [squash(code.join(''))], stems };
  }
  const query = tokens.slice(0, 7).join(' ');
  return { query, codes: [], stems };
}

/** Shops reached through an aggregator's redirect links (shop.by lists dozens). */
export const SHOPS_PER_AGGREGATOR = 4;

export type ResultLinks = {
  /** Cards on the searched site itself. */
  own: string[];
  /** Other shops' cards behind the site's outgoing links (`to.php?url=…`). */
  shops: string[];
};

/**
 * Product cards worth opening from a search results page: links whose text or
 * address carries the model code (or, without one, most of the name's
 * words), best first, one per address. A link that carries another address
 * in its query (an aggregator's «в магазин» redirect) is unwrapped — that
 * shop is the competitor — one card per shop, never one of `skipHosts`.
 */
export function pickResultLinks(
  html: string,
  pageUrl: string,
  q: CompetitorQuery,
  options: { max?: number; shops?: number; skipHosts?: Set<string> } = {},
): ResultLinks {
  const max = options.max ?? CARDS_PER_COMPETITOR;
  const base = new URL(pageUrl);
  const site = bareHost(base.hostname);
  const $ = cheerio.load(html);
  const own = new Map<string, { url: string; score: number }>();
  const shops = new Map<string, { url: string; score: number }>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (
      !href ||
      href.startsWith('#') ||
      /^(mailto|tel|javascript):/i.test(href)
    ) {
      return;
    }
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    const host = bareHost(url.hostname);
    if (host !== site && !host.endsWith(`.${site}`)) return;
    const target = redirectTarget(url);
    if (!target && (url.pathname === base.pathname || url.pathname === '/'))
      return;

    const label = [
      $(el).text(),
      $(el).attr('title') ?? '',
      $(el).find('img').attr('alt') ?? '',
    ].join(' ');
    const where = target ?? url;
    const haystack = squash(
      `${label} ${decodeSafe(where.hostname + where.pathname)}`,
    );
    let score: number;
    if (q.codes.length) {
      if (!q.codes.every((code) => haystack.includes(code))) return;
      score = 10 + labelStemShare(label, q.stems);
    } else {
      score = labelStemShare(label, q.stems);
      if (score < 0.7) return;
    }

    if (target) {
      const shop = bareHost(target.hostname);
      if (shop === site || options.skipHosts?.has(shop)) return;
      target.hash = '';
      const prev = shops.get(shop);
      if (!prev || score > prev.score)
        shops.set(shop, { url: target.toString(), score });
      return;
    }
    url.hash = '';
    const key = url.pathname.replace(/\/+$/, '');
    const prev = own.get(key);
    if (!prev || score > prev.score)
      own.set(key, { url: url.toString(), score });
  });
  const best = (m: Map<string, { url: string; score: number }>, n: number) =>
    [...m.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((s) => s.url);
  return {
    own: best(own, max),
    shops: best(shops, options.shops ?? SHOPS_PER_AGGREGATOR),
  };
}

/** `?url=https://shop/…` (or any parameter holding a whole address). */
function redirectTarget(url: URL): URL | null {
  for (const value of url.searchParams.values()) {
    if (!/^https?:\/\//i.test(value)) continue;
    try {
      const target = new URL(value);
      if (/^https?:$/.test(target.protocol) && target.pathname.length > 1)
        return target;
    } catch {
      /* not an address */
    }
  }
  return null;
}

export function bareHost(host: string) {
  return host.toLowerCase().replace(/^www\./, '');
}

function labelStemShare(label: string, stems: string[]) {
  if (!stems.length) return 0;
  const have = new Set(
    label
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map(stemRu),
  );
  return stems.filter((s) => have.has(s)).length / stems.length;
}

function decodeSafe(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
