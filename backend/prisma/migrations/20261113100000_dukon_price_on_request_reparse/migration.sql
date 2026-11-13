-- Data only, no schema change. dukon.by «Цена: уточняйте» items were parsed at
-- the 1 BYN placeholder of their hidden price block (~409 offers on
-- 2026-11-13; dukon.parse.ts `isPriceOnRequest` now withdraws the price).
-- Put those pages at the head of the queue (`visitedAt` NULL = never seen,
-- claimed first) so the next batches re-read them under the new rule instead
-- of in ~2 days behind the stalest snapshots. Exactly 1.00 is the placeholder;
-- a real 1 BYN item is simply re-read and keeps its price. Harmless on
-- rollback: the previous release re-reads them the old way.
UPDATE "SitemapsDukon" q
SET "status" = 'PENDING',
    "attempts" = 0,
    "visitedAt" = NULL,
    "lastTriedAt" = NULL,
    "lastError" = NULL
FROM "SourceProduct" sp
JOIN "Source" s ON s."id" = sp."sourceId"
WHERE s."code" = 'dukon'
  AND sp."url" = q."url"
  AND sp."price" = 1;
