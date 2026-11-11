-- Random published products whose descriptions are still the supplier's (not
-- written by AI or an admin), with what a writer needs: facts, the supplier
-- text (source, not a draft), the size line's siblings. Read-only.
-- psql -v n=100 -v root='' -v seed='x'   (root = first segment of Category.pathKey, '' = any)
\pset format unaligned
\pset tuples_only on
SELECT json_agg(x) FROM (
  SELECT p.id, p.slug, p.name, b.name AS brand, c.name AS category,
         split_part(c."pathKey", '/', 1) AS root, p.sku,
         p."descriptionShort" AS "supplierShort", left(p."descriptionFull", 3000) AS "supplierDescription",
         (SELECT json_object_agg(s.name, ps.value) FROM "ProductSpecification" ps
            JOIN "Specification" s ON s.id = ps."specificationId"
           WHERE ps."productId" = p.id
             AND s.name NOT IN ('Штрихкод','Производитель','Импортер/Продавец','Поставщик','Код')) AS specs,
         (SELECT json_agg(n) FROM (
            SELECT coalesce(nullif(f2."keyName", ''), p2.name) AS n
              FROM "ProductFamily" f2 JOIN "Product" p2 ON p2.id = f2."productId"
             WHERE f2."familyKey" = f."familyKey" AND f2."productId" <> p.id AND p2.status = 'PUBLISHED'
             LIMIT 8) s) AS siblings
  FROM "Product" p
  JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN "Brand" b ON b.id = p."brandId"
  LEFT JOIN "ProductFamily" f ON f."productId" = p.id
  WHERE p.status = 'PUBLISHED'
    AND (:'root' = '' OR split_part(c."pathKey", '/', 1) = :'root')
    AND split_part(c."pathKey", '/', 1) <> 'unmapped-supplier-products'
    AND NOT ('descriptionFull' = ANY(p."aiLockedFields") OR 'descriptionFull' = ANY(p."lockedFields"))
    AND NOT ('descriptionShort' = ANY(p."aiLockedFields") OR 'descriptionShort' = ANY(p."lockedFields"))
  ORDER BY md5(p.id || :'seed')
  LIMIT :n
) x;
