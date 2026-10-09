CREATE TABLE "ParserCatalogCrawl" (
    "sourceCode" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParserCatalogCrawl_pkey" PRIMARY KEY ("sourceCode")
);
