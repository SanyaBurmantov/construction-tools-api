-- Category identity moves from `slug` (the leaf name) to `pathKey` (the full
-- slug chain). Without this, "Аксессуары / … / Прочее" and
-- "Электроинструмент / … / Прочее" upserted into the same row, and the branch
-- that happened to parse first won the parent.

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "pathKey" TEXT;

-- Backfill from the existing slug chain.
UPDATE "Category" SET "pathKey" = array_to_string("path", '/');

-- Rows predating `path`, or with an empty one, fall back to their slug — which
-- is unique already, so they stay addressable.
UPDATE "Category"
SET "pathKey" = "slug"
WHERE "pathKey" IS NULL OR "pathKey" = '';

-- Defensive: if two rows somehow share a chain, keep both by suffixing the id.
-- A failed unique index here would abort the whole deploy.
UPDATE "Category" AS c
SET "pathKey" = c."pathKey" || '#' || c."id"
FROM (
  SELECT "pathKey" AS dup
  FROM "Category"
  GROUP BY "pathKey"
  HAVING count(*) > 1
) AS duplicates
WHERE c."pathKey" = duplicates.dup;

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "pathKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Category_pathKey_key" ON "Category"("pathKey");
