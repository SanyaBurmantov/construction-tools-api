CREATE TABLE "SourceCategory" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT,
    "parentId" TEXT,
    "level" INTEGER NOT NULL,
    "path" TEXT[],
    "mappedCategoryId" TEXT,

    CONSTRAINT "SourceCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceCategory_sourceId_externalId_key" ON "SourceCategory"("sourceId", "externalId");

ALTER TABLE "SourceProduct" ADD COLUMN "sourceCategoryId" TEXT;

ALTER TABLE "SourceCategory" ADD CONSTRAINT "SourceCategory_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceCategory" ADD CONSTRAINT "SourceCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SourceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceCategory" ADD CONSTRAINT "SourceCategory_mappedCategoryId_fkey" FOREIGN KEY ("mappedCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceProduct" ADD CONSTRAINT "SourceProduct_sourceCategoryId_fkey" FOREIGN KEY ("sourceCategoryId") REFERENCES "SourceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
