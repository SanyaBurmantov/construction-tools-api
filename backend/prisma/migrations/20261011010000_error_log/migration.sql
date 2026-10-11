-- The API's error log, readable from /admin/errors.
--
-- `occurrences`/`lastSeenAt` exist so a broken endpoint under load collapses
-- into one growing row instead of one row per failed request: the service bumps
-- the last row when the same failure repeats inside its dedupe window.
-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "stack" TEXT,
    "payload" JSONB,
    "actorLabel" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_statusCode_createdAt_idx" ON "ErrorLog"("statusCode", "createdAt");
