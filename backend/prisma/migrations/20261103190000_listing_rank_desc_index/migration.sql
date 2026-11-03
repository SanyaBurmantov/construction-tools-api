-- The catalogue orders by "listingRank" DESC, name ASC. The old index had
-- both ascending, which Postgres can read forwards or backwards but not in
-- that mixed order, so every listing sorted the whole catalogue instead.
DROP INDEX IF EXISTS "Product_status_listingRank_name_idx";
CREATE INDEX "Product_status_listingRank_name_idx" ON "Product"("status", "listingRank" DESC, "name");
