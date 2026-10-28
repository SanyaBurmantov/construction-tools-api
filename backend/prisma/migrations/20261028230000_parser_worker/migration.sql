-- Parsers, crons and AI tasks move to a separate worker process.

-- AlterTable
ALTER TABLE "ParserRuntimeStatus" ADD COLUMN "waitingSince" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "ParserJobRequestStatus" AS ENUM ('PENDING', 'TAKEN', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ParserJobRequest" (
    "id" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "params" JSONB,
    "status" "ParserJobRequestStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ParserJobRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParserJobRequest_status_createdAt_idx" ON "ParserJobRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ParserJobRequest_sourceCode_status_idx" ON "ParserJobRequest"("sourceCode", "status");
