-- Runtime site settings (the seller's requisites for invoices).
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- Requests that are not orders yet: quotes and product questions.
CREATE TYPE "LeadKind" AS ENUM ('QUOTE', 'QUESTION');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'IN_WORK', 'DONE', 'REJECTED');

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" "LeadKind" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "userId" TEXT,
    "companyName" TEXT,
    "taxId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "productSlug" TEXT,
    "items" JSONB,
    "total" DOUBLE PRECISION,
    "currency" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Lead_number_key" ON "Lead"("number");
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
CREATE INDEX "Lead_ipHash_createdAt_idx" ON "Lead"("ipHash", "createdAt");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Named lists of regular purchases.
CREATE TABLE "PurchaseList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseList_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseList_userId_updatedAt_idx" ON "PurchaseList"("userId", "updatedAt");
ALTER TABLE "PurchaseList" ADD CONSTRAINT "PurchaseList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
