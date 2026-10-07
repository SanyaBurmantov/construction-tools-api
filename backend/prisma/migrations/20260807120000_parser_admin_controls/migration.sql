-- Runtime parser controls: DB-backed settings + a category crawl queue.

-- AlterTable
ALTER TABLE "SourceCategory" ADD COLUMN "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ParserSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParserSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ParserCategoryQueue" (
    "id" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT[],
    "level" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "productsFound" INTEGER NOT NULL DEFAULT 0,
    "productsQueued" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastTriedAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParserCategoryQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParserCategoryQueue_sourceCode_url_key" ON "ParserCategoryQueue"("sourceCode", "url");

-- CreateIndex
CREATE INDEX "ParserCategoryQueue_sourceCode_status_idx" ON "ParserCategoryQueue"("sourceCode", "status");

-- CreateIndex
CREATE INDEX "ParserCategoryQueue_sourceCode_level_idx" ON "ParserCategoryQueue"("sourceCode", "level");
