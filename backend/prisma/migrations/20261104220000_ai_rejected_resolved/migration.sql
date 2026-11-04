-- «Отклонённое»: what an admin did with each field the AI checks refused.
ALTER TABLE "AiTaskItem" ADD COLUMN "resolved" JSONB;
