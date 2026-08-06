-- CreateEnum
CREATE TYPE "PricingScope" AS ENUM ('GLOBAL', 'CATEGORY', 'BRAND', 'SOURCE');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('NONE', 'INTEGER', 'CHARM_90', 'CHARM_99', 'TENS');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "appliedRuleId" TEXT,
ADD COLUMN     "costPrice" DOUBLE PRECISION,
ADD COLUMN     "priceReviewNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pricingMode" "PricingMode" NOT NULL DEFAULT 'AUTO';

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "PricingScope" NOT NULL DEFAULT 'GLOBAL',
    "categoryId" TEXT,
    "brandId" TEXT,
    "sourceId" TEXT,
    "minCost" DOUBLE PRECISION,
    "maxCost" DOUBLE PRECISION,
    "markupPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "markupFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minMargin" DOUBLE PRECISION,
    "rounding" "RoundingMode" NOT NULL DEFAULT 'CHARM_90',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costPrice" DOUBLE PRECISION,
    "oldPrice" DOUBLE PRECISION,
    "newPrice" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingRule_isActive_scope_idx" ON "PricingRule"("isActive", "scope");

-- CreateIndex
CREATE INDEX "PriceHistory_productId_createdAt_idx" ON "PriceHistory"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "PriceHistory_createdAt_idx" ON "PriceHistory"("createdAt");

-- CreateIndex
CREATE INDEX "Product_priceReviewNeeded_idx" ON "Product"("priceReviewNeeded");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_appliedRuleId_fkey" FOREIGN KEY ("appliedRuleId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
