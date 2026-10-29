-- AI tasks: billed tokens per task, and what the checks refused or flagged per item.
ALTER TABLE "AiTask" ADD COLUMN "promptTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiTask" ADD COLUMN "completionTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiTask" ADD COLUMN "cacheHitTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiTaskItem" ADD COLUMN "rejected" JSONB;
ALTER TABLE "AiTaskItem" ADD COLUMN "warnings" JSONB;

-- The sitemap's lastmod: when the page text changed, not the daily re-parse.
-- Existing rows start from their creation date.
ALTER TABLE "Product" ADD COLUMN "contentUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Product" SET "contentUpdatedAt" = "createdAt";

-- A supplier renamed a product whose name we locked.
ALTER TABLE "Product" ADD COLUMN "supplierNameChange" JSONB;
ALTER TABLE "Product" ADD COLUMN "supplierNameChangedAt" TIMESTAMP(3);

-- IndexNow queue.
CREATE TABLE "IndexNowUrl" (
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndexNowUrl_pkey" PRIMARY KEY ("url")
);
CREATE INDEX "IndexNowUrl_createdAt_idx" ON "IndexNowUrl"("createdAt");

-- The oldest offer of a merged product owns its card.
ALTER TABLE "SourceProduct" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
