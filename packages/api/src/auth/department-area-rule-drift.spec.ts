import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BASELINE_DEPARTMENT_AREAS } from './access-control.helper';

/**
 * Drift guard for the department -> operational-area mapping.
 *
 * The same mapping is expressed in three places, and an inconsistency between
 * them is a silent authorization bug rather than a test failure:
 *
 *   1. BASELINE_DEPARTMENT_AREAS (TypeScript) drives the application-layer
 *      check in evaluateAccessRules().
 *   2. DepartmentsService.ensureDefaultDepartments() materializes that same
 *      constant into DepartmentAreaRule rows, which the RLS helper
 *      app_private.department_area_allows() reads.
 *   3. Migration 20260903190000 embeds a literal copy of the mapping to
 *      backfill rules for departments created before it ran.
 *
 * (1) and (2) cannot drift — (2) reads the constant directly. (3) is a
 * hand-written SQL VALUES list, so this test parses it back out of the
 * migration and asserts it agrees with the constant exactly.
 */
const MIGRATION_SQL = join(
  __dirname,
  '..',
  '..',
  'prisma',
  'migrations',
  '20260903190000_kitchen_ticket_operational_area_and_department_rls',
  'migration.sql',
);

function parseMigrationMapping(): Record<string, Set<string>> {
  const sql = readFileSync(MIGRATION_SQL, 'utf8');

  // Isolate the backfill's VALUES list: everything between `VALUES` and the
  // `) AS m(code, area)` alias that closes it.
  const block = /VALUES\s*([\s\S]*?)\)\s*AS\s+m\(code,\s*area\)/.exec(sql);
  expect(block, 'backfill VALUES block not found in migration').not.toBeNull();

  const mapping: Record<string, Set<string>> = {};
  const pair = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(block![1])) !== null) {
    const [, code, area] = match;
    (mapping[code] ??= new Set<string>()).add(area);
  }
  return mapping;
}

describe('department area rule drift guard', () => {
  const migrationMapping = parseMigrationMapping();

  it('parses a non-trivial mapping out of the migration', () => {
    expect(Object.keys(migrationMapping).length).toBeGreaterThan(5);
  });

  it('covers exactly the same department codes as BASELINE_DEPARTMENT_AREAS', () => {
    expect(Object.keys(migrationMapping).sort()).toEqual(
      Object.keys(BASELINE_DEPARTMENT_AREAS).sort(),
    );
  });

  it.each(Object.keys(BASELINE_DEPARTMENT_AREAS))(
    'grants the same areas for "%s" in the migration backfill as in the constant',
    (code) => {
      const expected = [...BASELINE_DEPARTMENT_AREAS[code]].sort();
      const actual = [...(migrationMapping[code] ?? new Set<string>())].sort();
      expect(actual).toEqual(expected);
    },
  );
});
