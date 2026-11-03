-- Search journal (search-log/): what visitors search for, zero results, clicks.
CREATE TYPE "SearchEventKind" AS ENUM ('SEARCH', 'CLICK');

CREATE TABLE "SearchEvent" (
    "id" TEXT NOT NULL,
    "kind" "SearchEventKind" NOT NULL,
    "term" TEXT NOT NULL,
    "results" INTEGER,
    "productId" TEXT,
    "position" INTEGER,
    "source" TEXT NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SearchEvent_createdAt_idx" ON "SearchEvent"("createdAt");
CREATE INDEX "SearchEvent_term_createdAt_idx" ON "SearchEvent"("term", "createdAt");
