/**
 * What happened to one URL in a batch. Counted per run so health can react to a
 * parser that "succeeds" while failing on nearly every product.
 */
export type BatchOutcome = 'DONE' | 'SKIPPED' | 'FAILED' | 'DELISTED';

export type BatchResult = {
  processed: number;
  saved: number;
  skipped: number;
  failed: number;
  delisted: number;
};

export function emptyBatchResult(): BatchResult {
  return { processed: 0, saved: 0, skipped: 0, failed: 0, delisted: 0 };
}

export function countOutcome(result: BatchResult, outcome: BatchOutcome) {
  result.processed++;
  if (outcome === 'DONE') result.saved++;
  else if (outcome === 'SKIPPED') result.skipped++;
  else if (outcome === 'DELISTED') result.delisted++;
  else result.failed++;
  return result;
}

/** Share of hard failures — the signal that a parser is broken, not just busy. */
export function failureRate(result: BatchResult) {
  if (!result.processed) return 0;
  return result.failed / result.processed;
}
