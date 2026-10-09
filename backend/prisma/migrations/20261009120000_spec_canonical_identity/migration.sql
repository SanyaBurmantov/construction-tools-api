-- Canonical, source-independent identity for characteristics.
--
-- `Specification` is keyed by (categoryId, key), so the same characteristic is
-- one row per category — "Вес" was 773 rows. The facet builder returned one
-- entry per row, so a parent category showed "Вес" ten times, and the `specs`
-- query parameter carried a per-category UUID, so ticking a value filtered one
-- subcategory and dropped the rest of the subtree.
--
-- Columns are nullable: the normalizer (`catalog-normalizer`) backfills them
-- over the existing 227k rows, and facets ignore rows it has not reached yet.

ALTER TABLE "Specification" ADD COLUMN "canonicalKey" TEXT;
ALTER TABLE "Specification" ADD COLUMN "canonicalName" TEXT;
ALTER TABLE "Specification" ADD COLUMN "canonicalUnit" TEXT;

CREATE INDEX "Specification_canonicalKey_idx" ON "Specification"("canonicalKey");
CREATE INDEX "Specification_canonicalKey_filterable_idx" ON "Specification"("canonicalKey", "filterable");

ALTER TABLE "ProductSpecification" ADD COLUMN "valueNorm" TEXT;

CREATE INDEX "ProductSpecification_specificationId_valueNorm_idx" ON "ProductSpecification"("specificationId", "valueNorm");
