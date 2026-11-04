// node --test scripts/check-migrations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMigrationSql } from './check-migrations.mjs';

test('additive changes pass', () => {
  assert.deepEqual(
    checkMigrationSql(`
      ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
      CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
      CREATE TABLE "X" ("id" TEXT NOT NULL, "n" INTEGER NOT NULL, CONSTRAINT "X_pkey" PRIMARY KEY ("id"));
      ALTER TABLE "Product" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;
    `),
    [],
  );
});

test('breaking changes are reported', () => {
  const problems = checkMigrationSql(`
    ALTER TABLE "Product" DROP COLUMN "legacy";
    ALTER TABLE "Product" RENAME COLUMN "a" TO "b";
    ALTER TABLE "Product" ALTER COLUMN "sku" SET NOT NULL;
    ALTER TABLE "Product" ALTER COLUMN "price" SET DATA TYPE INTEGER;
    ALTER TABLE "Product" ADD COLUMN "code" TEXT NOT NULL;
    DROP TABLE "Old";
  `);
  assert.equal(problems.length, 6);
});

test('a reasoned comment allows the file', () => {
  assert.deepEqual(
    checkMigrationSql(`
      -- migration-safety: "legacy" has been unread since release 2026-11-01
      ALTER TABLE "Product" DROP COLUMN "legacy";
    `),
    [],
  );
});

test('a statement inside a comment does not count', () => {
  assert.deepEqual(checkMigrationSql(`-- once we DROP COLUMN "x" here\nSELECT 1;`), []);
});
