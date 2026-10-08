-- Earlier imports enabled article numbers as category filters. Keep the
-- specifications and product values; only remove them from filter selection.
UPDATE "Specification"
SET "filterable" = false
WHERE "filterable" = true
  AND ("name" ILIKE '%артикул%' OR "name" ILIKE '%sku%');
