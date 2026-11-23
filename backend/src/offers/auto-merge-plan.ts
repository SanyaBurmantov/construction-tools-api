/**
 * Which products of a barcode / brand+sku group the auto-merge folds into
 * which — pure, no database, so the rule is tested on its own.
 *
 * Checked on the real catalogue (2026-11-23, 3 540 groups): a group of
 * **different suppliers, one product each** is the same item listed by each
 * of them (BaumAuto pullers at dukon and th-tool, WorkPro knives at dukon and
 * b2bit). A group where **one supplier lists two of its products** is not:
 * five flavours of an ABRO air freshener under th-tool's one article, Autel
 * MS906 Pro MAX and MS906BT under dukon's one code, a used trimmer next to
 * the new one at tools.by. Those go to `/admin/duplicates` for a human —
 * an incorrect merge is expensive to unpick.
 *
 * And a price gap beyond the spike threshold is evidence against the match,
 * not a price change: JetaPro 5868068 is a 1.64 BYN mixing cup at tools.by
 * and a 230 BYN item at dukon. Merging those would also put the card into
 * the spike review of `/admin/pricing` — a human step either way.
 */

export type AutoMergeMember = {
  id: string;
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

export type AutoMergeSkip =
  | 'admin-decided'
  | 'one-supplier-lists-several'
  | 'prices-differ';

export type AutoMergePlan =
  | { targetId: string; duplicateIds: string[] }
  | { skip: AutoMergeSkip };

export function planAutoMerge(
  members: AutoMergeMember[],
  options: { maxPriceRatio: number },
): AutoMergePlan {
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
  if (
    prices.length > 1 &&
    Math.max(...prices) > Math.min(...prices) * options.maxPriceRatio
  ) {
    return { skip: 'prices-differ' };
  }

  // Survivor: on sale first; then the card whose text we rewrote — its text
  // and its URL (under SEO measurement) survive, the other one becomes a
  // 301 (129 such cards among the groups on 2026-11-23); then the most
  // *live* offers (a dead offer with no price is not worth keeping a card
  // for), then the richer card.
  const onSale = (member: AutoMergeMember) =>
    member.status === 'PUBLISHED' ? 1 : 0;
  const [target, ...duplicates] = [...candidates].sort(
    (a, b) =>
      onSale(b) - onSale(a) ||
      Number(b.hasAiText) - Number(a.hasAiText) ||
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
