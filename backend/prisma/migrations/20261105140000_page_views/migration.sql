-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 200,
    "isEntry" BOOLEAN NOT NULL DEFAULT false,
    "visitorId" TEXT,
    "device" TEXT NOT NULL,
    "source" TEXT,
    "referrer" TEXT,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageView_createdAt_idx" ON "PageView"("createdAt");

-- CreateIndex
CREATE INDEX "PageView_status_createdAt_idx" ON "PageView"("status", "createdAt");
