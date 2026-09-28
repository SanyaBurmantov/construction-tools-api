/*
  Warnings:

  - A unique constraint covering the columns `[categoryId,key]` on the table `Specification` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Specification_categoryId_key_key" ON "Specification"("categoryId", "key");
