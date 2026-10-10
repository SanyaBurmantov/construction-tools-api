-- Both of these foreign keys were unindexed, so every lookup of a product's
-- images or supplier offers was a sequential scan over the whole child table
-- (147k ProductImage rows, 69k SourceProduct rows).
--
-- The outage that prompted this: /admin/stats counts published products with
-- no images, which Prisma renders as
--   id NOT IN (SELECT "productId" FROM "ProductImage" ...)
-- With no index that query ran for 13+ minutes, pinning both cores. The admin
-- gate called /admin/stats, so every reload of /admin queued another copy
-- until the Prisma pool was exhausted and nobody could sign in at all.
--
-- Plain CREATE INDEX, not CONCURRENTLY: `prisma migrate deploy` runs each
-- migration inside a transaction, where CONCURRENTLY is not allowed. At these
-- row counts the build takes a second or two.
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");
CREATE INDEX "SourceProduct_productId_idx" ON "SourceProduct"("productId");
