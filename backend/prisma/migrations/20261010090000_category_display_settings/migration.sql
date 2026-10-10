-- Admin-controlled presentation for categories.
--
-- The tree the storefront navigates is built by the parsers from supplier
-- breadcrumbs, so until now its order was "whatever has the most products" and
-- a branch could only be removed from the menu by deleting or merging it.
-- These three columns make the menu curatable without touching identity
-- (`pathKey`), which the parsers keep upserting on.
--
-- Defaults preserve current behaviour: everything visible, nothing pinned,
-- `sortOrder = 0` so the count-then-name ordering still decides every tie.

ALTER TABLE "Category" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN "isVisible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Category" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Category_isVisible_sortOrder_idx" ON "Category"("isVisible", "sortOrder");
