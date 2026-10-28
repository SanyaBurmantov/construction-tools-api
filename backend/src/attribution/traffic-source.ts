/**
 * Where a buyer came from, as one readable label — «yandex / cpc»,
 * «google / organic», «t.me / social», «direct». The shop is paid for sales
 * the site brings, so every order and lead carries it.
 *
 * Pure: the storefront sends the raw touch (UTM tags, click ids, the
 * referrer's host), the label is decided here, in one tested place.
 */
export type Touch = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Yandex Direct click id. */
  yclid?: string;
  /** Google Ads click id. */
  gclid?: string;
  /** Host of an external referrer, no path or query. */
  referrer?: string;
  /** The first page of that visit (path only). */
  landing?: string;
  /** ISO time of the visit. */
  at?: string;
};

const SEARCH_ENGINES: Array<[RegExp, string]> = [
  // The engine's own zone only: `google.evil.com` is not Google.
  [/(^|\.)yandex\.(?:[a-z]{2,3}|com\.[a-z]{2})$|(^|\.)ya\.ru$/, 'yandex'],
  [/(^|\.)google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)go\.mail\.ru$/, 'mail.ru'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
];

const SOCIAL =
  /(^|\.)(vk\.com|vk\.ru|ok\.ru|t\.me|telegram\.org|instagram\.com|facebook\.com|l\.facebook\.com|tiktok\.com|youtube\.com|viber\.com)$/;

const clean = (value?: string) => value?.trim().toLowerCase() || '';

/** Our own hosts never count as a referrer. */
export function isOwnHost(host: string, ownHosts: string[]): boolean {
  const h = clean(host).replace(/^www\./, '');
  return ownHosts.some((own) => clean(own).replace(/^www\./, '') === h);
}

/** The label for one touch. */
export function trafficSourceLabel(touch?: Touch | null): string {
  if (!touch) return 'direct';
  const source = clean(touch.utmSource);
  const medium = clean(touch.utmMedium);
  if (source) return `${source} / ${medium || '(not set)'}`;
  if (touch.yclid) return 'yandex / cpc';
  if (touch.gclid) return 'google / cpc';
  const referrer = clean(touch.referrer).replace(/^www\./, '');
  if (!referrer) return 'direct';
  for (const [pattern, name] of SEARCH_ENGINES) {
    if (pattern.test(referrer)) return `${name} / organic`;
  }
  if (SOCIAL.test(referrer)) return `${referrer} / social`;
  return `${referrer} / referral`;
}

/** Whether a touch carries any source at all (a direct visit does not). */
export function hasSource(touch?: Touch | null): boolean {
  return trafficSourceLabel(touch) !== 'direct';
}

/**
 * The columns an Order or a Lead stores: the label of the last non-direct
 * touch (the usual «last non-direct click» model — a customer who found us
 * through an ad and came back by typing the address still counts for the
 * ad), the first touch's label, and both raw touches for later analysis.
 */
export function attributionColumns(
  attribution?: { first?: Touch; last?: Touch } | null,
) {
  const first = attribution?.first;
  const last = attribution?.last;
  const lastWithSource = hasSource(last) ? last : first;
  return {
    trafficSource: trafficSourceLabel(lastWithSource),
    firstTrafficSource: first ? trafficSourceLabel(first) : null,
    attribution:
      first || last ? { first: first ?? null, last: last ?? null } : undefined,
  };
}
