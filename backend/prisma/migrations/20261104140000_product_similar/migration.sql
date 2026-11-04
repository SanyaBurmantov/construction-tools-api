-- Precomputed «Похожие»: ranked ids per product (similar-refresh.service.ts).
-- CreateTable
CREATE TABLE "ProductSimilar" (
    "productId" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSimilar_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "ProductSimilar_computedAt_idx" ON "ProductSimilar"("computedAt");

-- AddForeignKey
ALTER TABLE "ProductSimilar" ADD CONSTRAINT "ProductSimilar_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

