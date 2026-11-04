#!/usr/bin/env node
/**
 * Expand → contract: a migration must not break the release before it.
 *
 * deploy/auto-deploy.sh applies migrations *before* the new containers start
 * and, when a release fails its health checks, rolls back to the previous
 * images in seconds — on the already-migrated schema. Rolling back the code
 * never rolls back the SQL. So the previous code must keep working on the new
 * schema: a column is added (nullable or with a default) and only dropped in a
 * later release, once no running code reads it; a rename is "add new, copy,
 * switch code, drop old" over two releases.
 *
 * This check fails CI on statements that break the previous code, in
 * migrations newer than BASELINE (older ones are history). A statement that is
 * genuinely safe — the column was unused for a release already, the table is
 * new in this very migration — is allowed by a comment anywhere in the file:
 *
 *   -- migration-safety: <why the previous release survives this>
 *
 * Usage: node scripts/check-migrations.mjs [migrations dir]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Migrations up to this one predate the rule. */
export const BASELINE = '20261104100000';

const RULES = [
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN — the previous release still reads/writes it'],
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE — the previous release still uses it'],
  [/\bRENAME\s+(COLUMN\s+)?\S+\s+TO\b/i, 'RENAME — the previous release uses the old name'],
  [/\bALTER\s+TABLE\s+\S+\s+RENAME\s+TO\b/i, 'RENAME TABLE — the previous release uses the old name'],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, 'ALTER COLUMN … TYPE — may reject what the previous release writes'],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, 'SET NOT NULL — the previous release may insert NULL'],
  [/\bDROP\s+TYPE\b/i, 'DROP TYPE — an enum the previous release uses'],
  [/\bALTER\s+TYPE\s+\S+\s+RENAME\s+VALUE\b/i, 'enum value renamed — the previous release writes the old one'],
];

/** ADD COLUMN … NOT NULL without DEFAULT: the previous release's INSERTs omit it. */
function addsRequiredColumn(statement) {
  return (
    /\bADD\s+COLUMN\b/i.test(statement) &&
    /\bNOT\s+NULL\b/i.test(statement) &&
    !/\bDEFAULT\b/i.test(statement)
  );
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Problems in one migration's SQL; [] when it is safe or explicitly allowed. */
export function checkMigrationSql(sql) {
  if (/--\s*migration-safety:\s*\S/i.test(sql)) return [];
  const problems = [];
  for (const statement of stripComments(sql).split(';')) {
    const text = statement.trim();
    if (!text) continue;
    const short = text.replace(/\s+/g, ' ').slice(0, 120);
    for (const [pattern, why] of RULES) {
      if (pattern.test(text)) problems.push(`${why}\n      ${short}`);
    }
    // A table created in this same migration has no previous code using it.
    if (addsRequiredColumn(text) && !/\bCREATE\s+TABLE\b/i.test(text)) {
      problems.push(`ADD COLUMN … NOT NULL without DEFAULT — the previous release's INSERTs omit it\n      ${short}`);
    }
  }
  return problems;
}

export function checkMigrations(dir) {
  const report = [];
  for (const name of readdirSync(dir).sort()) {
    if (name <= BASELINE) continue;
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    const problems = checkMigrationSql(readFileSync(file, 'utf8'));
    if (problems.length) report.push({ name, problems });
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir =
    process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');
  const report = checkMigrations(dir);
  if (!report.length) {
    console.log('Migrations: nothing that breaks the previous release.');
    process.exit(0);
  }
  console.error('Migrations that would break the release before them (expand → contract):\n');
  for (const { name, problems } of report) {
    console.error(`  ${name}`);
    for (const problem of problems) console.error(`    - ${problem}`);
  }
  console.error(
    '\nSplit the change over two releases (add now, drop/rename later), or, when the previous\n' +
      'release really survives it, say why in the file: -- migration-safety: <reason>',
  );
  process.exit(1);
}
