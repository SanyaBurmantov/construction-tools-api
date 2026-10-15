-- CreateEnum
CREATE TYPE "AiEntity" AS ENUM ('PRODUCT', 'CATEGORY');

-- CreateEnum
CREATE TYPE "AiTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiTaskItemStatus" AS ENUM ('PENDING', 'APPLIED', 'UNCHANGED', 'FAILED', 'REVERTED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aiLockedFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AiPrompt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" "AiEntity" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" "AiEntity" NOT NULL,
    "status" "AiTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "fields" TEXT[],
    "promptId" TEXT,
    "promptText" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "batchSize" INTEGER NOT NULL DEFAULT 5,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTaskItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "status" "AiTaskItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "changes" JSONB,
    "response" JSONB,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPrompt_entity_idx" ON "AiPrompt"("entity");

-- CreateIndex
CREATE INDEX "AiTask_status_scheduledAt_idx" ON "AiTask"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AiTask_createdAt_idx" ON "AiTask"("createdAt");

-- CreateIndex
CREATE INDEX "AiTaskItem_taskId_status_idx" ON "AiTaskItem"("taskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskItem_taskId_entityId_key" ON "AiTaskItem"("taskId", "entityId");

-- AddForeignKey
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "AiPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTaskItem" ADD CONSTRAINT "AiTaskItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

