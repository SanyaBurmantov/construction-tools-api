CREATE TABLE "SitemapsToolsBy" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isVisited" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastTriedAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),

    CONSTRAINT "SitemapsToolsBy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SitemapsToolsBy_url_key" ON "SitemapsToolsBy"("url");
