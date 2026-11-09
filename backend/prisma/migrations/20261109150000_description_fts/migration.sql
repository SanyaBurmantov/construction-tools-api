-- Full-text indexes over product and supplier descriptions, for the
-- uniqueness check (src/ai-detector/uniqueness-sql.ts). It used to scan every
-- description with LIKE per check: 4–7 s on prod, and only byte-identical
-- phrases matched. Expression indexes, not generated columns (no table
-- rewrite); measured on prod 2026-11-09: ~25 s + ~20 s of to_tsvector to
-- build, writes to these tables (the parsers) wait meanwhile.
-- The first 4000 characters only: a copy starts early, and it bounds the index.
-- Both expressions must stay byte-identical to uniqueness-sql.ts (tested), or
-- the planner stops using the index.
CREATE INDEX "Product_description_fts_idx" ON "Product" USING GIN ((to_tsvector('russian'::regconfig, left(COALESCE("descriptionShort", '') || ' ' || COALESCE("descriptionFull", ''), 4000))));
CREATE INDEX "SourceProduct_description_fts_idx" ON "SourceProduct" USING GIN ((to_tsvector('russian'::regconfig, left(COALESCE("description", ''), 4000))));
