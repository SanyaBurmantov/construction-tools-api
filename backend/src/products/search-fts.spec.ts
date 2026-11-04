import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFtsQuery, FTS_DOCUMENT_SQL, ftsDocumentSql } from './search-fts';

describe('buildFtsQuery', () => {
  it('ANDs every word as a prefix — any form, any order', () => {
    expect(buildFtsQuery('Перфораторы MAKITA')).toBe(
      'перфораторы:* & makita:*',
    );
  });

  it('expands trade synonyms and fleeting-vowel stems', () => {
    expect(buildFtsQuery('болгарки')).toBe(
      '(болгарки:* | болгарк:* | ушм:* | углошлифовальн:*)',
    );
    expect(buildFtsQuery('уровни лазерные')).toBe(
      '(уровни:* | уровн:* | уровен:*) & лазерные:*',
    );
    expect(buildFtsQuery('диски 125')).toBe(
      '(диски:* | диск:* | круг:*) & 125:*',
    );
  });

  it('lets only letters and digits through, so it is never a tsquery syntax error', () => {
    expect(buildFtsQuery("Бита PH2 1/4'' & | ! (x) :*")).toBe(
      'бита:* & ph2:* & 1:* & 4:*',
    );
    expect(buildFtsQuery('Ёлка')).toBe('елка:*');
    expect(buildFtsQuery('— ! ?')).toBeNull();
    expect(buildFtsQuery('м')).toBeNull();
  });

  it('keeps sizes and codes whole', () => {
    expect(buildFtsQuery('болт м10х40')).toBe('болт:* & м10х40:*');
    expect(buildFtsQuery('HR2470')).toBe('hr2470:*');
  });
});

describe('FTS document', () => {
  // The planner uses the GIN index only for the very expression it was built
  // on: an edit here without a new migration silently turns every search
  // into a scan of the catalogue.
  it('is exactly the indexed expression of the migration', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261104120000_product_search_fts/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain(`USING GIN (${FTS_DOCUMENT_SQL});`);
  });

  it('qualifies the columns for a joined query', () => {
    expect(ftsDocumentSql('p')).toContain('p."name"');
    expect(ftsDocumentSql('p')).not.toMatch(/[^.]"sku"/);
  });
});
