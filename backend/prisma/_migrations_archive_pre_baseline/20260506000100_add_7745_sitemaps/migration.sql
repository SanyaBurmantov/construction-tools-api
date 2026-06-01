CREATE TABLE "Sitemaps7745" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isVisited" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastTriedAt" TIMESTAMP(3),
    "visitedAt" TIMESTAMP(3),

    CONSTRAINT "Sitemaps7745_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Sitemaps7745_url_key" ON "Sitemaps7745"("url");
