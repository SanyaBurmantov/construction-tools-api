-- Supplier connection state per route (parser/connection/): direct or proxy,
-- OK / DEGRADED / BLOCKED. New table only.
CREATE TABLE "SupplierConnection" (
    "sourceCode" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "failureKind" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastOkAt" TIMESTAMP(3),
    "lastFailAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastStatus" INTEGER,
    "lastMs" INTEGER,
    "blockedSince" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierConnection_pkey" PRIMARY KEY ("sourceCode","route")
);
