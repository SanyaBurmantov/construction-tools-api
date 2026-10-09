-- This data repair is atomic. It does not delete products, offers or images.
BEGIN;

CREATE TABLE "CategoryRedirect" (
  "slug" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CategoryRedirect_categoryId_idx" ON "CategoryRedirect"("categoryId");
CREATE TABLE "CategoryRepairConflict" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "fromSpecificationId" TEXT NOT NULL,
  "toSpecificationId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "keptValue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK checks and reference transfers must not scan every product value for
-- every duplicate specification removed during the repair.
CREATE INDEX "ProductSpecification_specificationId_idx" ON "ProductSpecification"("specificationId");

DO $$
DECLARE
  navigation_id TEXT;
  fallback_id TEXT;
BEGIN
  SELECT id INTO navigation_id FROM "Category"
  WHERE slug = 'glavnaya' AND lower(trim(name)) = 'главная' AND "parentId" IS NULL;
  IF navigation_id IS NULL THEN RETURN; END IF;

  -- Stop writers while the snapshot of the tree and references is repaired.
  LOCK TABLE "Category", "Product", "Specification", "ProductSpecification",
    "SourceCategory", "PricingRule" IN SHARE ROW EXCLUSIVE MODE;

  INSERT INTO "Category" (id, name, slug, "pathKey", level, path, "seoTitle", "seoDescription")
  VALUES (gen_random_uuid()::text, 'Неразобранные товары поставщиков',
    'unmapped-supplier-products', 'unmapped-supplier-products', 0,
    ARRAY['unmapped-supplier-products'], 'Неразобранные товары поставщиков',
    'Неразобранные товары поставщиков')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO fallback_id FROM "Category" WHERE slug = 'unmapped-supplier-products';

  -- Old slug-based upserts sometimes overwrote parentId while leaving path
  -- unchanged. Include detached legacy paths, not just reachable descendants.
  CREATE TEMP TABLE repair_nodes ON COMMIT DROP AS
  SELECT id, slug, "parentId", path[2:cardinality(path)] AS new_path,
    array_to_string(path[2:cardinality(path)], '/') AS new_key
  FROM "Category" WHERE path[1] = 'glavnaya' AND id <> navigation_id;

  IF EXISTS (SELECT 1 FROM repair_nodes WHERE cardinality(new_path) = 0 OR new_key = '') THEN
    RAISE EXCEPTION 'Legacy category paths are incomplete; refusing to guess taxonomy';
  END IF;

  -- A parent overwritten by an old slug collision may have lost the legacy
  -- identity entirely. Recreate only missing path prefixes, using a retained
  -- Russian category name with the same identity component (never a guess).
  CREATE TEMP TABLE repair_prefixes ON COMMIT DROP AS
  SELECT DISTINCT n.new_path[1:depth] AS path,
    array_to_string(n.new_path[1:depth], '/') AS key
  FROM repair_nodes n CROSS JOIN LATERAL generate_series(1, cardinality(n.new_path)-1) AS depth
  WHERE NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."pathKey" = array_to_string(n.new_path[1:depth], '/'))
    AND NOT EXISTS (SELECT 1 FROM repair_nodes old WHERE old.new_key = array_to_string(n.new_path[1:depth], '/'));
  IF EXISTS (SELECT 1 FROM repair_prefixes p WHERE NOT EXISTS (
    SELECT 1 FROM "Category" c WHERE c.path[cardinality(c.path)] = p.path[cardinality(p.path)]
  )) THEN
    RAISE EXCEPTION 'Missing category name for a legacy path prefix; refusing to invent labels';
  END IF;
  INSERT INTO "Category" (id, name, slug, "pathKey", level, path, "seoTitle", "seoDescription")
  SELECT gen_random_uuid()::text, label.name,
    array_to_string(p.path, '-') || '-' || substr(gen_random_uuid()::text, 1, 8),
    p.key, cardinality(p.path)-1, p.path, label.name, label.name
  FROM repair_prefixes p CROSS JOIN LATERAL (
    SELECT c.name FROM "Category" c
    WHERE c.path[cardinality(c.path)] = p.path[cardinality(p.path)]
    ORDER BY (cardinality(c.path) = cardinality(p.path)) DESC, c.id LIMIT 1
  ) label;

  -- Prefer the already canonical row when the cleaned path exists. Otherwise
  -- keep one legacy ID and its public slug, even if legacy paths were duplicated.
  CREATE TEMP TABLE repair_plan ON COMMIT DROP AS
  SELECT n.id AS old_id,
    coalesce(c.id, min(n.id) OVER (PARTITION BY n.new_key)) AS target_id,
    n.slug, n."parentId" AS old_parent_id, n.new_path, n.new_key
  FROM repair_nodes n LEFT JOIN "Category" c ON c."pathKey" = n.new_key
    AND NOT EXISTS (SELECT 1 FROM repair_nodes old WHERE old.id = c.id)
    AND c.id <> navigation_id;
  INSERT INTO repair_plan VALUES (navigation_id, fallback_id, 'glavnaya', NULL,
    ARRAY['unmapped-supplier-products'], 'unmapped-supplier-products');

  UPDATE "Product" p SET "categoryId" = r.target_id
    FROM repair_plan r WHERE p."categoryId" = r.old_id AND r.old_id <> r.target_id;
  UPDATE "SourceCategory" s SET "mappedCategoryId" = r.target_id
    FROM repair_plan r WHERE s."mappedCategoryId" = r.old_id AND r.old_id <> r.target_id;
  UPDATE "PricingRule" p SET "categoryId" = r.target_id
    FROM repair_plan r WHERE p."categoryId" = r.old_id AND r.old_id <> r.target_id;

  -- Fold specification definitions by their new (category, key). Existing
  -- target definitions win, and different duplicate product values are archived.
  CREATE TEMP TABLE repair_specs ON COMMIT DROP AS
  WITH affected AS (
    SELECT s.*, coalesce(r.target_id, s."categoryId") AS new_category_id
    FROM "Specification" s LEFT JOIN repair_plan r ON r.old_id = s."categoryId"
    WHERE r.old_id IS NOT NULL OR s."categoryId" IN (SELECT target_id FROM repair_plan)
  )
  SELECT id AS old_id, new_category_id,
    first_value(id) OVER (PARTITION BY new_category_id, key
      ORDER BY ("categoryId" = new_category_id) DESC, id) AS target_id
  FROM affected;
  CREATE TEMP TABLE repair_values ON COMMIT DROP AS
  SELECT v.*, s.target_id,
    first_value(v.value) OVER w AS kept_value,
    row_number() OVER w AS position
  FROM "ProductSpecification" v JOIN repair_specs s ON s.old_id = v."specificationId"
  WINDOW w AS (PARTITION BY v."productId", s.target_id
    ORDER BY (v."specificationId" = s.target_id) DESC, v.id);

  INSERT INTO "CategoryRepairConflict" (id, "productId", "fromSpecificationId",
    "toSpecificationId", value, "keptValue")
  SELECT id, "productId", "specificationId", target_id, value, kept_value
    FROM repair_values WHERE position > 1 AND value IS DISTINCT FROM kept_value;
  DELETE FROM "ProductSpecification" v USING repair_values r
    WHERE v.id = r.id AND r.position > 1;
  UPDATE "ProductSpecification" v SET "specificationId" = r.target_id
    FROM repair_values r WHERE v.id = r.id AND r.position = 1 AND v."specificationId" <> r.target_id;
  UPDATE "Specification" s SET filterable = f.filterable
    FROM (SELECT r.target_id, bool_or(s.filterable) AS filterable
      FROM repair_specs r JOIN "Specification" s ON s.id = r.old_id GROUP BY r.target_id) f
    WHERE s.id = f.target_id;
  DELETE FROM "Specification" s USING repair_specs r WHERE s.id = r.old_id AND r.old_id <> r.target_id;
  UPDATE "Specification" s SET "categoryId" = r.new_category_id
    FROM repair_specs r WHERE s.id = r.target_id;

  UPDATE "CategoryRedirect" a SET "categoryId" = r.target_id
    FROM repair_plan r WHERE a."categoryId" = r.old_id AND r.old_id <> r.target_id;
  INSERT INTO "CategoryRedirect" (slug, "categoryId")
    SELECT slug, target_id FROM repair_plan WHERE old_id <> target_id;

  -- Move children away from rows about to be removed, including clean rows
  -- which an older manual mapping attached under a legacy parent.
  UPDATE "Category" c SET "parentId" = CASE WHEN r.old_id = navigation_id THEN NULL ELSE r.target_id END
    FROM repair_plan r WHERE c."parentId" = r.old_id AND r.old_id <> r.target_id;
  DELETE FROM "Category" c USING repair_plan r WHERE c.id = r.old_id AND r.old_id <> r.target_id;
  UPDATE "Category" c SET path = r.new_path, "pathKey" = r.new_key,
    level = cardinality(r.new_path) - 1
  FROM repair_plan r WHERE c.id = r.target_id AND r.old_id <> navigation_id;
  UPDATE "Category" c SET "parentId" = NULL
  WHERE cardinality(c.path) = 1 AND c.id IN (SELECT target_id FROM repair_plan);
  UPDATE "Category" c SET "parentId" = parent.id
  FROM "Category" parent
  WHERE cardinality(c.path) > 1
    AND parent."pathKey" = array_to_string(c.path[1:cardinality(c.path)-1], '/')
    AND (c.id IN (SELECT target_id FROM repair_plan) OR c."pathKey" IN (SELECT key FROM repair_prefixes));
  IF EXISTS (
    SELECT 1 FROM "Category" c LEFT JOIN "Category" parent ON parent.id=c."parentId"
    WHERE (c.id IN (SELECT target_id FROM repair_plan) OR c."pathKey" IN (SELECT key FROM repair_prefixes))
      AND cardinality(c.path) > 1
      AND (parent.id IS NULL OR parent."pathKey" <> array_to_string(c.path[1:cardinality(c.path)-1], '/'))
  ) THEN RAISE EXCEPTION 'Legacy tree repair left an unresolved parent'; END IF;

END $$;

COMMIT;
