-- Size variants of one line on one card («Сверло 6 / 8 / 12 мм»), built by
-- the relations worker; see products/relations/variants.ts.
CREATE TABLE "ProductFamily" (
    "productId" TEXT NOT NULL,
    "familyKey" CHAR(32) NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("productId"),
    CONSTRAINT "ProductFamily_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProductFamily_familyKey_idx" ON "ProductFamily"("familyKey");
