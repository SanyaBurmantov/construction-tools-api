CREATE TABLE "SitemapsDukon" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isVisited" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SitemapsDukon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SitemapsDukon_url_key" ON "SitemapsDukon"("url");
