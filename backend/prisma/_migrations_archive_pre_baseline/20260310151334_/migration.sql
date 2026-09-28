/*
  Warnings:

  - The `specs` column on the `Product` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "priceValue" DROP NOT NULL,
ALTER COLUMN "priceCurrency" DROP NOT NULL,
ALTER COLUMN "stockStatus" DROP NOT NULL,
ALTER COLUMN "seoTitle" DROP NOT NULL,
ALTER COLUMN "seoDescription" DROP NOT NULL,
DROP COLUMN "specs",
ADD COLUMN     "specs" JSONB[];
