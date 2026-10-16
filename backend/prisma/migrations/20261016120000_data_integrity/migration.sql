
-- CreateEnum
CREATE TYPE "StatusSource" AS ENUM ('SYSTEM', 'ADMIN');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "lockedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "statusSource" "StatusSource" NOT NULL DEFAULT 'SYSTEM';

-- AlterTable
ALTER TABLE "Specification" ADD COLUMN     "filterableLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BrandAlias" (
    "slug" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "BrandAlias_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "CategoryPathAlias" (
    "pathKey" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CategoryPathAlias_pkey" PRIMARY KEY ("pathKey")
);

-- CreateIndex
CREATE INDEX "BrandAlias_brandId_idx" ON "BrandAlias"("brandId");

-- CreateIndex
CREATE INDEX "CategoryPathAlias_categoryId_idx" ON "CategoryPathAlias"("categoryId");

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE INDEX "ErrorLog_lastSeenAt_idx" ON "ErrorLog"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ErrorLog_statusCode_lastSeenAt_idx" ON "ErrorLog"("statusCode", "lastSeenAt");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "Product_status_updatedAt_idx" ON "Product"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_appliedRuleId_idx" ON "Product"("appliedRuleId");

-- CreateIndex
CREATE INDEX "Sitemaps7745_status_visitedAt_idx" ON "Sitemaps7745"("status", "visitedAt");

-- CreateIndex
CREATE INDEX "SitemapsDukon_status_visitedAt_idx" ON "SitemapsDukon"("status", "visitedAt");

-- CreateIndex
CREATE INDEX "SitemapsThTools_status_visitedAt_idx" ON "SitemapsThTools"("status", "visitedAt");

-- CreateIndex
CREATE INDEX "SitemapsToolsBy_status_visitedAt_idx" ON "SitemapsToolsBy"("status", "visitedAt");

-- CreateIndex
CREATE INDEX "UserListItem_productId_idx" ON "UserListItem"("productId");

-- AddForeignKey
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPathAlias" ADD CONSTRAINT "CategoryPathAlias_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: who set the current status. Archiving was always an admin act.
UPDATE "Product" SET "statusSource" = 'ADMIN' WHERE "status" = 'ARCHIVED';

-- A delisted product has no priced offer left (delistOffer clears the price),
-- so a HIDDEN product that still has one was hidden by hand.
UPDATE "Product" p SET "statusSource" = 'ADMIN'
WHERE p."status" = 'HIDDEN'
  AND EXISTS (
    SELECT 1 FROM "SourceProduct" sp
    WHERE sp."productId" = p."id" AND sp."price" IS NOT NULL AND sp."price" > 0
  );
