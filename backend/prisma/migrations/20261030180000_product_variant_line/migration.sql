-- «Линейка» and «Подпись варианта» set by an admin (the size switch), and the
-- name a family is read from — the supplier's, so an AI rewrite of the shown
-- name does not split a line.
ALTER TABLE "Product" ADD COLUMN "variantLine" VARCHAR(120);
ALTER TABLE "Product" ADD COLUMN "variantLabel" VARCHAR(60);

ALTER TABLE "ProductFamily" ALTER COLUMN "familyKey" DROP NOT NULL;
ALTER TABLE "ProductFamily" ADD COLUMN "keyName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductFamily" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;
