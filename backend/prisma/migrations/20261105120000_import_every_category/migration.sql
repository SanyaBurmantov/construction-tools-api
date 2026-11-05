-- Owner, 2026-11-05: import every supplier category — car accessories,
-- garden, household goods, cosmetics. The exclude regexes are gone from the
-- code defaults and docker-compose.prod.yml; this brings back what they kept
-- out. Data only, no DDL.

-- 1. Products the old filters hid.
--
-- The nightly normalizer hid them as a SYSTEM status, but the 2026-10-16
-- backfill (20261016120000_data_integrity) relabelled every HIDDEN product
-- that still had a priced offer as ADMIN, so nothing would ever have
-- republished them. Nobody hid them by hand (the admin audit log has no
-- product status change). Matched by the same category name chain the
-- normalizer used, with the union of both old regexes.
--
-- A product with a price goes back on sale now (no pricing rule is active,
-- so its price is the supplier's last one, the same basis as the rest of the
-- catalogue). One without a price stays HIDDEN but becomes SYSTEM again, so
-- `publishIfReady()` publishes it as soon as a parse gives it a price.
WITH RECURSIVE chain AS (
  SELECT "id", "name"::text AS "chain" FROM "Category" WHERE "parentId" IS NULL
  UNION ALL
  SELECT c."id", chain."chain" || ' / ' || c."name"
  FROM "Category" c JOIN chain ON c."parentId" = chain."id"
),
target AS (
  SELECT p."id"
  FROM "Product" p JOIN chain ch ON ch."id" = p."categoryId"
  WHERE p."status" = 'HIDDEN'
    AND ch."chain" ~* 'косметика|автохими|автоламп|антенн|ароматизатор|брелок|ковры напольные|кресла детские|очки для чтения|помощь водителю|щ[её]тки стеклоочистител|уход за авто|внешний тюнинг|внутрисалонн|велотехник|дача, отдых|товары для дома|товары для уборки|посуда|текстиль|игрушк|канцеляр|зоотовар|космет|бытовая химия|продукты питания'
)
UPDATE "Product" p
SET "statusSource" = 'SYSTEM',
    "status" = CASE WHEN p."priceValue" > 0 THEN 'PUBLISHED'::"ProductStatus" ELSE p."status" END
FROM target
WHERE p."id" = target."id";

-- 2. URLs the filters skipped: back to the queue, first in line
--    (batches take "visitedAt" NULLS FIRST). Rows the weekly SKIPPED re-check
--    already requeued keep their PENDING status and only move up.
UPDATE "SitemapsThTools"
SET "status" = 'PENDING', "attempts" = 0, "lastError" = NULL, "visitedAt" = NULL
WHERE "lastError" LIKE 'Category is filtered out%';

UPDATE "SitemapsToolsBy"
SET "status" = 'PENDING', "attempts" = 0, "lastError" = NULL, "visitedAt" = NULL
WHERE "lastError" LIKE 'Category is filtered out%';

UPDATE "SitemapsDukon"
SET "status" = 'PENDING', "attempts" = 0, "lastError" = NULL, "visitedAt" = NULL
WHERE "lastError" LIKE 'Category is filtered out%';
