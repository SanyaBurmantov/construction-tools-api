UPDATE "Product"
SET "priceCurrency" = 'BYN'
WHERE "priceCurrency" IS NULL
   OR "priceCurrency" !~ '^[A-Z]{3}$';
