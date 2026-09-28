-- CreateEnum
CREATE TYPE "ParserRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ParserRun" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ParserRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParserRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParserRun_key_startedAt_idx" ON "ParserRun"("key", "startedAt");

-- CreateIndex
CREATE INDEX "ParserRun_startedAt_idx" ON "ParserRun"("startedAt");
