-- The AI assistant (ai/assist): suggestions to accept, brand+category
-- landings, a draft answer on a lead. New tables and nullable columns only.

-- CreateEnum
CREATE TYPE "AiSuggestionKind" AS ENUM ('CATEGORY', 'SYNONYM', 'SPEC_MERGE', 'DUPLICATE', 'VARIANT');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'REVERTED', 'INFO');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "aiDraft" JSONB,
ADD COLUMN     "aiDraftAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "kind" "AiSuggestionKind" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandCategoryLanding" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "h1" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "rejected" JSONB,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandCategoryLanding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSuggestion_kind_status_createdAt_idx" ON "AiSuggestion"("kind", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_kind_key_key" ON "AiSuggestion"("kind", "key");

-- CreateIndex
CREATE INDEX "BrandCategoryLanding_categoryId_idx" ON "BrandCategoryLanding"("categoryId");

-- CreateIndex
CREATE INDEX "BrandCategoryLanding_isPublished_idx" ON "BrandCategoryLanding"("isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "BrandCategoryLanding_brandId_categoryId_key" ON "BrandCategoryLanding"("brandId", "categoryId");

-- AddForeignKey
ALTER TABLE "BrandCategoryLanding" ADD CONSTRAINT "BrandCategoryLanding_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandCategoryLanding" ADD CONSTRAINT "BrandCategoryLanding_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

