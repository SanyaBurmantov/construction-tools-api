CREATE TABLE "ParserError" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParserError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParserError_createdAt_idx" ON "ParserError"("createdAt");
CREATE INDEX "ParserError_url_idx" ON "ParserError"("url");
