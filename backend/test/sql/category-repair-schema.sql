-- Minimal catalog contract with the same unique keys and foreign keys as Prisma.
CREATE TABLE "Category" (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  "pathKey" TEXT UNIQUE NOT NULL, "parentId" TEXT REFERENCES "Category"(id), level INT NOT NULL,
  path TEXT[] NOT NULL, "seoTitle" TEXT NOT NULL DEFAULT '', "seoDescription" TEXT NOT NULL DEFAULT '');
CREATE TABLE "Product" (id TEXT PRIMARY KEY, "categoryId" TEXT NOT NULL REFERENCES "Category"(id), status TEXT NOT NULL);
CREATE TABLE "ProductImage" (id TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "Product"(id), url TEXT NOT NULL);
CREATE TABLE "SourceProduct" (id TEXT PRIMARY KEY, "productId" TEXT REFERENCES "Product"(id), price NUMERIC, "lastSync" TIMESTAMP NOT NULL);
CREATE TABLE "SourceCategory" (id TEXT PRIMARY KEY, "mappedCategoryId" TEXT REFERENCES "Category"(id));
CREATE TABLE "PricingRule" (id TEXT PRIMARY KEY, "categoryId" TEXT REFERENCES "Category"(id), "markupPercent" NUMERIC NOT NULL);
CREATE TABLE "Specification" (id TEXT PRIMARY KEY, "categoryId" TEXT NOT NULL REFERENCES "Category"(id), key TEXT NOT NULL,
  filterable BOOLEAN NOT NULL DEFAULT false, UNIQUE("categoryId",key));
CREATE TABLE "ProductSpecification" (id TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "Product"(id),
  "specificationId" TEXT NOT NULL REFERENCES "Specification"(id), value TEXT NOT NULL, UNIQUE("productId","specificationId"));
