import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The snapshot page loader's ORDER BY for contract_date must read like the live ranking (`ts.contract_date <dir> NULLS LAST, ts.created_at DESC NULLS LAST, ts.id`): the snapshot keeps
 * "no contract date" as 1970-01-01 (NOT NULL), the live rows have a real NULL that sorts last in both directions.
 */
describe('trucking snapshot page: contract_date order', () => {
  const src = readFileSync(join(__dirname, 'pipelineDailySummary.service.ts'), 'utf8');

  it('is one of the sort fields the loader takes', () => {
    expect(src).toContain("export type TruckingSnapshotPageSortField = 'supplier' | 'created_at' | 'contract_date';");
  });

  it('turns the 1970 placeholder back into NULL, puts it last, and breaks ties by created_at DESC then operation_id', () => {
    expect(src).toContain(
      "`NULLIF(contract_date, DATE '1970-01-01') ${dir} NULLS LAST, created_at DESC NULLS LAST, operation_id`",
    );
  });

  it('leaves the created_at and supplier orders as they were', () => {
    expect(src).toContain('`created_at ${dir} NULLS LAST, operation_id`');
    expect(src).toContain('`supplier ${dir} NULLS LAST, created_at DESC NULLS LAST, operation_id`');
  });
});
