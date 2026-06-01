ALTER TABLE "SourceProduct" ADD COLUMN "sku" TEXT;

WITH ranked_source_products AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "sourceId", "url"
            ORDER BY "lastSync" DESC, "id" DESC
        ) AS row_number
    FROM "SourceProduct"
)
DELETE FROM "SourceProduct"
WHERE "id" IN (
    SELECT "id"
    FROM ranked_source_products
    WHERE row_number > 1
);

CREATE UNIQUE INDEX "SourceProduct_sourceId_url_key" ON "SourceProduct"("sourceId", "url");
