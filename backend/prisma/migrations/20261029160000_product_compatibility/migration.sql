CREATE TABLE "ProductCompatibility" (
    "accessoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "accessorySignature" CHAR(32) NOT NULL,
    "productSignature" CHAR(32) NOT NULL,
    "modelCode" VARCHAR(80) NOT NULL,
    "evidenceField" VARCHAR(32) NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCompatibility_pkey" PRIMARY KEY ("accessoryId", "productId"),
    CONSTRAINT "ProductCompatibility_distinct_products" CHECK ("accessoryId" <> "productId"),
    CONSTRAINT "ProductCompatibility_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductCompatibility_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProductCompatibility_productId_accessoryId_idx"
    ON "ProductCompatibility"("productId", "accessoryId");
