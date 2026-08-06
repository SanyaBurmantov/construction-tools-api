-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "matchBarcode" TEXT,
ADD COLUMN     "matchModel" TEXT,
ADD COLUMN     "matchSku" TEXT;

-- CreateTable
CREATE TABLE "ProductRedirect" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRedirect_slug_key" ON "ProductRedirect"("slug");

-- CreateIndex
CREATE INDEX "ProductRedirect_productId_idx" ON "ProductRedirect"("productId");

-- CreateIndex
CREATE INDEX "Product_matchBarcode_idx" ON "Product"("matchBarcode");

-- CreateIndex
CREATE INDEX "Product_matchSku_idx" ON "Product"("matchSku");

-- CreateIndex
CREATE INDEX "Product_matchModel_idx" ON "Product"("matchModel");

-- AddForeignKey
ALTER TABLE "ProductRedirect" ADD CONSTRAINT "ProductRedirect_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
