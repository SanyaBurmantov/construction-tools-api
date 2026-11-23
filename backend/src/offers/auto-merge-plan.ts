import { namesDifferentKinds } from './item-kind';

/**
 * Which products of a barcode / brand+sku group the auto-merge folds into
 * which — pure, no database, so the rule is tested on its own.
 *
 * Checked on the real catalogue (2026-11-23, 1 901 cross-supplier groups):
 * a group of **different suppliers, one product each** is the same item
 * listed by each of them (BaumAuto pullers at dukon and th-tool, WorkPro
 * knives at dukon and b2bit). A group where **one supplier lists two of its
 * products** is not — five flavours of an ABRO air freshener under th-tool's
 * one article, Autel MS906 Pro MAX and MS906BT under dukon's one code — and
 * is never merged automatically (the key query already drops those).
 *
 * What is left can still be two different things under one article, and
 * that is a **conflict** for a human (`MergeConflict`, `/admin/duplicates`),
 * not a merge: titles naming different kinds of item (`item-kind.ts`:
 * «Домкрат» vs «Расширитель», 16 groups) or prices more than 3× apart
 * (JetaPro 5868068: a 1.64 BYN cup at tools.by, 230 BYN at dukon; 25
 * groups). A smaller gap is a dealer RRP against a retail price (WorkPro at
 * b2bit is ~1.57× dukon's) — merged, and the dearer card stays, so the merge
 * does not trip the price-spike review.
 */

export type AutoMergeMember = {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
  statusSource: 'SYSTEM' | 'ADMIN';
  priceValue: number | null;
  /** Offers with a price (`SourceProduct.price > 0`). */
  liveOffers: number;
  /** Every offer, priced or not. */
  offerCount: number;
  hasImage: boolean;
  /** Text we rewrote (`aiLockedFields`): the card worth keeping. */
  hasAiText: boolean;
  /** Distinct suppliers among its offers; empty for a hand-made product. */
  sourceIds: string[];
};

export type AutoMergeSkip = 'admin-decided' | 'one-supplier-lists-several';

export type MergeConflictReason = 'names' | 'price';

export type AutoMergePlan =
  | { targetId: string; duplicateIds: string[] }
  | { skip: AutoMergeSkip }
  | { conflict: MergeConflictReason; priceRatio: number | null };

/** Prices further apart than this are two different things, not two prices. */
export const CONFLICT_PRICE_RATIO = 3;

export function planAutoMerge(
  members: AutoMergeMember[],
  options: { conflictPriceRatio?: number } = {},
): AutoMergePlan {
  const conflictPriceRatio = options.conflictPriceRatio ?? CONFLICT_PRICE_RATIO;
  // Products an admin hid or archived are a human decision: they are neither
  // folded away automatically nor allowed to absorb a live card.
  const candidates = members.filter(
    (member) =>
      !(
        member.statusSource === 'ADMIN' &&
        (member.status === 'HIDDEN' || member.status === 'ARCHIVED')
      ),
  );
  if (candidates.length < 2) return { skip: 'admin-decided' };

  const seen = new Set<string>();
  for (const member of candidates) {
    for (const sourceId of member.sourceIds) {
      if (seen.has(sourceId)) return { skip: 'one-supplier-lists-several' };
      seen.add(sourceId);
    }
  }

  const prices = candidates
    .map((member) => member.priceValue)
    .filter((price): price is number => price != null && price > 0);
  const priceRatio =
    prices.length > 1
      ? Math.round((Math.max(...prices) / Math.min(...prices)) * 100) / 100
      : null;
  if (priceRatio != null && priceRatio > conflictPriceRatio) {
    return { conflict: 'price', priceRatio };
  }
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (namesDifferentKinds(candidates[i].name, candidates[j].name)) {
        return { conflict: 'names', priceRatio };
      }
    }
  }

  // Survivor: on sale first; then the card whose text we rewrote — its text
  // and its URL (under SEO measurement) survive, the other one becomes a
  // 301 (129 such cards among the groups on 2026-11-23); then the dearer
  // card — the merged price is the dearest offer's, so its cost does not
  // move and the spike guard stays quiet; then the most *live* offers, then
  // the richer card.
  const onSale = (member: AutoMergeMember) =>
    member.status === 'PUBLISHED' ? 1 : 0;
  const [target, ...duplicates] = [...candidates].sort(
    (a, b) =>
      onSale(b) - onSale(a) ||
      Number(b.hasAiText) - Number(a.hasAiText) ||
      (b.priceValue ?? 0) - (a.priceValue ?? 0) ||
      b.liveOffers - a.liveOffers ||
      b.offerCount - a.offerCount ||
      Number(b.hasImage) - Number(a.hasImage) ||
      a.id.localeCompare(b.id),
  );
  return {
    targetId: target.id,
    duplicateIds: duplicates.map((member) => member.id),
  };
}
