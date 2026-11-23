-- Groups the auto-merge leaves for a human (different kinds of item, or a
-- price gap over 3x). Expand-only: a new table the previous release never reads.

-- CreateTable
CREATE TABLE "MergeConflict" (
    "id" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "productIds" TEXT[],
    "priceRatio" DOUBLE PRECISION,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,

    CONSTRAINT "MergeConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MergeConflict_signal_key_key" ON "MergeConflict"("signal", "key");

-- CreateIndex
CREATE INDEX "MergeConflict_dismissedAt_idx" ON "MergeConflict"("dismissedAt");
