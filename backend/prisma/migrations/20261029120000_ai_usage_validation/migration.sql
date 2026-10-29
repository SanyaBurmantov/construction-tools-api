-- AI tasks: billed tokens per task, and the fields validation refused per item.
ALTER TABLE "AiTask" ADD COLUMN "promptTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiTask" ADD COLUMN "completionTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiTask" ADD COLUMN "cacheHitTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiTaskItem" ADD COLUMN "rejected" JSONB;
