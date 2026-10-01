/*
  Warnings:

  - A unique constraint covering the columns `[login]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "login" TEXT,
ADD COLUMN     "name" TEXT DEFAULT '',
ADD COLUMN     "surname" TEXT DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
