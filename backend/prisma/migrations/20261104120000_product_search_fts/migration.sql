-- Russian full-text search over products (src/products/search-fts.ts).
-- An expression index, not a generated column: adding a stored column would
-- rewrite the whole Product table under an exclusive lock; this builds the
-- index in a few seconds and only blocks writes (parsers) meanwhile.
-- The expression must stay byte-identical to FTS_DOCUMENT_SQL, or the
-- planner stops using the index (search-fts.spec.ts checks).
CREATE INDEX "Product_search_fts_idx" ON "Product" USING GIN ((setweight(to_tsvector('russian'::regconfig, COALESCE(substring("name" from '^\S+(?:\s+\S+)?'), '')), 'A') || to_tsvector('russian'::regconfig, "name" || ' ' || COALESCE("sku", '') || ' ' || COALESCE("model", ''))));
