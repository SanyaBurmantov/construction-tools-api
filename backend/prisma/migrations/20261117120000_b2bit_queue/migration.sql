-- b2bit.by (АйТи Дистрибуция, B2B portal): product queue of the new supplier.
-- Same shape as the other Sitemaps<Source> tables. Expand-only: a rollback to
-- the previous release simply never reads it.

-- CreateTable
CREATE TABLE "SitemapsB2bit" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isVisited" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastTriedAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),

    CONSTRAINT "SitemapsB2bit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SitemapsB2bit_url_key" ON "SitemapsB2bit"("url");

-- CreateIndex
CREATE INDEX "SitemapsB2bit_status_visitedAt_idx" ON "SitemapsB2bit"("status", "visitedAt");
