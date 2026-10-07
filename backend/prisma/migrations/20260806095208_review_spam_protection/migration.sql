-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "ipHash" TEXT;

-- CreateIndex
CREATE INDEX "Review_ipHash_createdAt_idx" ON "Review"("ipHash", "createdAt");
