-- CreateEnum
CREATE TYPE "UserListKind" AS ENUM ('WISHLIST', 'COMPARE');

-- CreateTable
CREATE TABLE "UserListItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "UserListKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserListItem_userId_kind_idx" ON "UserListItem"("userId", "kind");

-- CreateIndex
CREATE INDEX "UserListItem_createdAt_idx" ON "UserListItem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserListItem_userId_kind_productId_key" ON "UserListItem"("userId", "kind", "productId");

-- AddForeignKey
ALTER TABLE "UserListItem" ADD CONSTRAINT "UserListItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListItem" ADD CONSTRAINT "UserListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
