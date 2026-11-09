/**
 * The documents the uniqueness check searches, as SQL. Each must stay
 * byte-identical to its index in
 * `prisma/migrations/20261109150000_description_fts` (uniqueness-sql.spec.ts
 * reads the migration) — a different expression is a full scan.
 */
export const PRODUCT_DESCRIPTION_DOC_SQL = `to_tsvector('russian'::regconfig, left(COALESCE("descriptionShort", '') || ' ' || COALESCE("descriptionFull", ''), 4000))`;

export const SOURCE_DESCRIPTION_DOC_SQL = `to_tsvector('russian'::regconfig, left(COALESCE("description", ''), 4000))`;
