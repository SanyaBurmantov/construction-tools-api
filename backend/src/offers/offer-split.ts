/**
 * Which offers of one product are really other products. Pure; the service
 * (offer-split.service.ts) does the writing.
 *
 * The old parser keyed products by a slug of the name, so every th-tool.by
 * listing with the same title — Forsage F-STG-32, RockForce RF-STG-32, … —
 * was attached to one card: on 2026-11-02, 7 471 cards held 23 813 offers
 * with as many different articles, and ~16k products were missing from the
 * catalogue (the card showed the cheapest of them as its price). One supplier
 * giving two listings two different articles is that supplier saying they
 * are two products. Different articles *across* suppliers mean nothing —
 * each supplier's `sku` is its own internal number.
 */
export type SplitOffer = {
  id: string;
  sourceId: string;
  url: string;
  sku: string | null;
  name: string;
};

export type SplitGroup = {
  sourceId: string;
  article: string;
  offers: SplitOffer[];
};

/** `C0044[ GM ]` and `c0044 gm` are one article. */
export function articleKey(sku: string | null | undefined): string {
  return (sku ?? '').replace(/[^0-9a-zа-яё]/gi, '').toUpperCase();
}

/**
 * `offers` in ownership order (oldest first, as ProductIdentityService reads
 * them). The owner's article — and every offer without one — stays on the
 * card; each other (supplier, article) becomes a product of its own. A
 * product whose suppliers each name one article (or none) is left alone.
 */
export function planSplit(offers: SplitOffer[]): SplitGroup[] {
  const owner = offers[0];
  if (!owner) return [];
  const ownerArticle = articleKey(owner.sku);
  const groups = new Map<string, SplitGroup>();
  for (const offer of offers) {
    const article = articleKey(offer.sku);
    if (!article) continue;
    if (offer.sourceId === owner.sourceId && article === ownerArticle) continue;
    const key = `${offer.sourceId}|${article}`;
    const group = groups.get(key) ?? {
      sourceId: offer.sourceId,
      article,
      offers: [],
    };
    group.offers.push(offer);
    groups.set(key, group);
  }
  // Only a supplier that itself lists two articles here proves a false
  // merge; an article from another supplier is that supplier's number for
  // the same thing.
  const articlesBySource = new Map<string, Set<string>>();
  for (const offer of offers) {
    const article = articleKey(offer.sku);
    if (!article) continue;
    const set = articlesBySource.get(offer.sourceId) ?? new Set<string>();
    set.add(article);
    articlesBySource.set(offer.sourceId, set);
  }
  return [...groups.values()].filter(
    (group) => (articlesBySource.get(group.sourceId)?.size ?? 0) > 1,
  );
}
