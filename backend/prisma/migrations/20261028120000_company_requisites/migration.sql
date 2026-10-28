-- Invoice requisites on a company account.
ALTER TABLE "User" ADD COLUMN "legalAddress" TEXT,
                   ADD COLUMN "bankAccount" TEXT,
                   ADD COLUMN "bankName" TEXT,
                   ADD COLUMN "bankBic" TEXT;

-- The payer, snapshotted into the order at checkout.
ALTER TABLE "Order" ADD COLUMN "payerType" "CustomerType",
                    ADD COLUMN "payerName" TEXT,
                    ADD COLUMN "payerTaxId" TEXT,
                    ADD COLUMN "payerAddress" TEXT,
                    ADD COLUMN "payerAccount" TEXT,
                    ADD COLUMN "payerBankName" TEXT,
                    ADD COLUMN "payerBankBic" TEXT;

CREATE INDEX "Order_payerTaxId_idx" ON "Order"("payerTaxId");

-- Orders placed before this from a company account: take the payer from the
-- account as it is now — the best record there is.
UPDATE "Order" o
SET "payerType" = 'COMPANY',
    "payerName" = u."companyName",
    "payerTaxId" = u."taxId"
FROM "User" u
WHERE o."userId" = u."id"
  AND u."customerType" = 'COMPANY'
  AND u."companyName" IS NOT NULL;
