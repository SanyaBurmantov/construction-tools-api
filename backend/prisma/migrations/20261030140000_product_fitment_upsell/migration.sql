-- Fit by standard (disc diameter, SDS shank, battery platform, 1/4" hex),
-- built by the relations worker; see products/relations/fitment.ts.
CREATE TABLE "ProductFitment" (
    "productId" TEXT NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "role" VARCHAR(4) NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    CONSTRAINT "ProductFitment_pkey" PRIMARY KEY ("productId", "key", "role"),
    CONSTRAINT "ProductFitment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProductFitment_key_role_idx" ON "ProductFitment"("key", "role");

-- Which recommendation block sold the line: the upsell report.
ALTER TABLE "OrderItem" ADD COLUMN "upsellSource" VARCHAR(16);
