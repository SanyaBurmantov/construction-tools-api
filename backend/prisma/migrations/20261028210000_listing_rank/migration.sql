-- How complete a product card is (photo 2 + description 1); the default
-- catalogue order puts complete cards first. Kept fresh by ListingRankService.
ALTER TABLE "Product" ADD COLUMN "listingRank" INTEGER NOT NULL DEFAULT 0;

UPDATE "Product" p SET "listingRank" =
  (CASE WHEN EXISTS (
     SELECT 1 FROM "ProductImage" i
     WHERE i."productId" = p."id"
       AND lower(i."url") NOT LIKE '%/themes/%'
       AND lower(i."url") NOT LIKE '%/default.%'
       AND lower(i."url") NOT LIKE '%no_photo%'
   ) THEN 2 ELSE 0 END)
  + (CASE WHEN coalesce(p."descriptionFull", '') <> '' OR coalesce(p."descriptionShort", '') <> '' THEN 1 ELSE 0 END);

CREATE INDEX "Product_status_listingRank_name_idx" ON "Product"("status", "listingRank", "name");
