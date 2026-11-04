-- AI texts for brand pages, and instructions per field (templates and tasks).
-- Expand only: a new enum value, nullable / defaulted columns.

ALTER TYPE "AiEntity" ADD VALUE IF NOT EXISTS 'BRAND';

-- A saved template: which fields it fills and an instruction per field.
ALTER TABLE "AiPrompt" ADD COLUMN "fields" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AiPrompt" ADD COLUMN "fieldTexts" JSONB;

-- The admin's own part of a task's instruction ({ general, fields }), kept
-- apart from the composed promptText: the phrases quoted there are what the
-- checks let through verbatim.
ALTER TABLE "AiTask" ADD COLUMN "promptParts" JSONB;
