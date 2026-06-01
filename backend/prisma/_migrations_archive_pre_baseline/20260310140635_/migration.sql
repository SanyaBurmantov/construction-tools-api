/*
  Warnings:

  - A unique constraint covering the columns `[url]` on the table `SitemapsThTools` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SitemapsThTools" ALTER COLUMN "isVisited" SET DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "SitemapsThTools_url_key" ON "SitemapsThTools"("url");
