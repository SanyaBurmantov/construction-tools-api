-- Run on a LOCAL test database: psql -X -v ON_ERROR_STOP=1 -d parser_repair_test -f test/sql/category-navigation-repair.sql
\set ON_ERROR_STOP on
DROP SCHEMA IF EXISTS category_repair_cases_test CASCADE;
CREATE SCHEMA category_repair_cases_test;
SET search_path TO category_repair_cases_test;
\ir category-repair-schema.sql
INSERT INTO "Category" (id,name,slug,"pathKey","parentId",level,path) VALUES
 ('home','Главная','glavnaya','glavnaya',NULL,0,ARRAY['glavnaya']),
 ('old-tools','Инструмент','legacy-tools','glavnaya/tools','home',1,ARRAY['glavnaya','tools']),
 ('tools','Инструмент','tools','tools',NULL,0,ARRAY['tools']),
 ('old-drills','Дрели','legacy-drills','glavnaya/tools/drills','old-tools',2,ARRAY['glavnaya','tools','drills']),
 ('drills','Дрели','drills','tools/drills','tools',1,ARRAY['tools','drills']),
 ('accessories','Аксессуары','accessories','glavnaya/tools/drills/accessories','old-drills',3,ARRAY['glavnaya','tools','drills','accessories']),
 ('saws','Пилы','saws','glavnaya/tools/saws','old-tools',2,ARRAY['glavnaya','tools','saws']),
 ('equipment','Оборудование','equipment','equipment',NULL,0,ARRAY['equipment']),
 ('keys','Ключи','equipment-keys','equipment/keys','equipment',1,ARRAY['equipment','keys']),
 ('detached','Разводные','adjustable','glavnaya/tools/keys/adjustable','keys',3,ARRAY['glavnaya','tools','keys','adjustable']);
INSERT INTO "Product" VALUES ('p0','home','DRAFT'),('p1','old-drills','PUBLISHED'),('p2','old-drills','HIDDEN'),('p3','drills','PUBLISHED');
INSERT INTO "ProductImage" VALUES ('image','p1','https://example.test/product.jpg');
INSERT INTO "SourceProduct" VALUES ('offer','p1',123.45,'2026-10-01 12:00');
INSERT INTO "SourceCategory" VALUES ('mapped','old-drills'),('home-map','home');
INSERT INTO "PricingRule" VALUES ('rule','old-drills',17.5);
INSERT INTO "Specification" VALUES ('old-weight','old-drills','weight',true),('weight','drills','weight',false),('diameter','old-drills','diameter',false);
INSERT INTO "ProductSpecification" VALUES
 ('conflict','p1','old-weight','10'),('kept','p1','weight','12'),('moved','p2','old-weight','20'),
 ('duplicate','p3','old-weight','12'),('same-kept','p3','weight','12'),('diameter-value','p1','diameter','25');
\ir ../../prisma/migrations/20261009010000_repair_navigation_category/migration.sql
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Category" WHERE path[1]='glavnaya') THEN RAISE EXCEPTION 'Navigation paths remain'; END IF;
 IF (SELECT count(*) FROM "Product") <> 4 OR (SELECT count(*) FROM "SourceProduct") <> 1 OR (SELECT count(*) FROM "ProductImage") <> 1 THEN RAISE EXCEPTION 'Catalog records lost'; END IF;
 IF (SELECT "categoryId" FROM "Product" WHERE id='p0') <> (SELECT id FROM "Category" WHERE slug='unmapped-supplier-products') THEN RAISE EXCEPTION 'Direct root product lost'; END IF;
 IF (SELECT status FROM "Product" WHERE id='p0') <> 'DRAFT' OR (SELECT status FROM "Product" WHERE id='p2') <> 'HIDDEN' THEN RAISE EXCEPTION 'Product status changed'; END IF;
 IF (SELECT "categoryId" FROM "Product" WHERE id='p1') <> 'drills' THEN RAISE EXCEPTION 'Product not merged'; END IF;
 IF (SELECT "parentId" FROM "Category" WHERE id='accessories') <> 'drills' THEN RAISE EXCEPTION 'Merged children not moved'; END IF;
 IF (SELECT "pathKey" FROM "Category" WHERE id='detached') <> 'tools/keys/adjustable' OR (SELECT "pathKey" FROM "Category" WHERE id=(SELECT "parentId" FROM "Category" WHERE id='detached')) <> 'tools/keys' THEN RAISE EXCEPTION 'Detached path not repaired'; END IF;
 IF (SELECT "mappedCategoryId" FROM "SourceCategory" WHERE id='mapped') <> 'drills' THEN RAISE EXCEPTION 'Mapping lost'; END IF;
 IF (SELECT "categoryId" FROM "PricingRule" WHERE id='rule') <> 'drills' OR (SELECT "markupPercent" FROM "PricingRule" WHERE id='rule') <> 17.5 THEN RAISE EXCEPTION 'Pricing rule changed'; END IF;
 IF (SELECT "categoryId" FROM "CategoryRedirect" WHERE slug='legacy-drills') <> 'drills' THEN RAISE EXCEPTION 'Old URL lost'; END IF;
 IF (SELECT "categoryId" FROM "Specification" WHERE id='diameter') <> 'drills' OR NOT (SELECT filterable FROM "Specification" WHERE id='weight') THEN RAISE EXCEPTION 'Specification metadata lost'; END IF;
 IF (SELECT value FROM "ProductSpecification" WHERE id='kept') <> '12' OR (SELECT "specificationId" FROM "ProductSpecification" WHERE id='moved') <> 'weight' THEN RAISE EXCEPTION 'Specification value not transferred'; END IF;
 IF (SELECT count(*) FROM "CategoryRepairConflict") <> 1 OR (SELECT value FROM "CategoryRepairConflict" WHERE id='conflict') <> '10' THEN RAISE EXCEPTION 'Conflicting value not archived'; END IF;
 IF (SELECT count(*) FROM "ProductSpecification") <> 4 THEN RAISE EXCEPTION 'Duplicate values not folded'; END IF;
 IF (SELECT price FROM "SourceProduct" WHERE id='offer') <> 123.45 OR (SELECT "lastSync" FROM "SourceProduct" WHERE id='offer') <> timestamp '2026-10-01 12:00' THEN RAISE EXCEPTION 'Offer changed'; END IF;
END $$;

DROP SCHEMA IF EXISTS category_repair_empty_test CASCADE;
CREATE SCHEMA category_repair_empty_test;
SET search_path TO category_repair_empty_test;
\ir category-repair-schema.sql
INSERT INTO "Category" (id,name,slug,"pathKey",level,path) VALUES ('normal','Нормальная категория','normal','normal',0,ARRAY['normal']);
\ir ../../prisma/migrations/20261009010000_repair_navigation_category/migration.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM "Category") <> 1 OR (SELECT count(*) FROM "CategoryRedirect") <> 0 THEN RAISE EXCEPTION 'Repair touched a clean database'; END IF;
END $$;
SET search_path TO public;
DROP SCHEMA category_repair_cases_test CASCADE;
DROP SCHEMA category_repair_empty_test CASCADE;
SELECT 'category repair cases passed' AS result;
