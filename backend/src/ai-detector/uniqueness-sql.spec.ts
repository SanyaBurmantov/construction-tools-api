import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRODUCT_DESCRIPTION_DOC_SQL,
  SOURCE_DESCRIPTION_DOC_SQL,
} from './uniqueness-sql';

describe('uniqueness search documents', () => {
  it('match their indexes byte for byte', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261109150000_description_fts/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain(
      `ON "Product" USING GIN ((${PRODUCT_DESCRIPTION_DOC_SQL}))`,
    );
    expect(migration).toContain(
      `ON "SourceProduct" USING GIN ((${SOURCE_DESCRIPTION_DOC_SQL}))`,
    );
  });
});
