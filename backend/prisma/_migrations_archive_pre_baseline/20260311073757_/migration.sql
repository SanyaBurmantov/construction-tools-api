/*
  Warnings:

  - A unique constraint covering the columns `[productId,specificationId]` on the table `ProductSpecification` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ProductSpecification_productId_specificationId_key" ON "ProductSpecification"("productId", "specificationId");
