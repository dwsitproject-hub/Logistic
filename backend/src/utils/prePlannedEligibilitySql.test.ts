import { describe, expect, it } from 'vitest';
import { buildPrePlannedEligibleContractsQuery } from './prePlannedEligibilitySql';

/**
 * `PRE_PLANNED_EXCLUDED_PLANTS` only falls back to its defaults when the env var is blank -
 * set to "," it parses to an empty list, which used to emit `NOT IN ()` and fail the whole
 * eligibility query with a syntax error. An empty list must simply drop the clause.
 */
describe('buildPrePlannedEligibleContractsQuery', () => {
  it('emits the plant exclusion clause when plants are given', async () => {
    const { sql, params } = await buildPrePlannedEligibleContractsQuery({
      excludedPlants: ['Blank', 'Trading'],
      minOsMt: 100,
    });
    expect(sql).toContain('NOT IN ($2, $3)');
    expect(params).toEqual([100 * 1000, 'Blank', 'Trading']);
  });

  it('omits the clause entirely for an empty plant list (never NOT IN ())', async () => {
    const { sql, params } = await buildPrePlannedEligibleContractsQuery({
      excludedPlants: [],
      minOsMt: 100,
    });
    expect(sql).not.toContain('NOT IN ()');
    /** $2 would be the first plant placeholder; other NOT IN clauses in this SQL are literals. */
    expect(sql).not.toContain('NOT IN ($2');
    expect(params).toEqual([100 * 1000]);
  });
});
