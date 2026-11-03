-- Supplier photos copied to our S3 (media/image-mirror.service.ts).
CREATE TYPE "ImageMirrorStatus" AS ENUM ('STORED', 'FAILED');

CREATE TABLE "ImageMirror" (
    "sourceUrl" TEXT NOT NULL,
    "status" "ImageMirrorStatus" NOT NULL,
    "key" TEXT,
    "bytes" INTEGER,
    "contentType" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "lastTriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storedAt" TIMESTAMP(3),
    CONSTRAINT "ImageMirror_pkey" PRIMARY KEY ("sourceUrl")
);
CREATE INDEX "ImageMirror_status_lastTriedAt_idx" ON "ImageMirror"("status", "lastTriedAt");

-- Every existing row still shows the supplier's photo, so its URL is the source.
ALTER TABLE "ProductImage" ADD COLUMN "sourceUrl" TEXT;
UPDATE "ProductImage" SET "sourceUrl" = "url";
ALTER TABLE "ProductImage" ALTER COLUMN "sourceUrl" SET NOT NULL;
CREATE INDEX "ProductImage_sourceUrl_idx" ON "ProductImage"("sourceUrl");
