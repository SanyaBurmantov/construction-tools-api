-- CreateTable
CREATE TABLE "AiDetectorCheck" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "words" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "AiDetectorCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDetectorCheck_createdAt_idx" ON "AiDetectorCheck"("createdAt");

-- CreateIndex
CREATE INDEX "AiDetectorCheck_textHash_idx" ON "AiDetectorCheck"("textHash");
