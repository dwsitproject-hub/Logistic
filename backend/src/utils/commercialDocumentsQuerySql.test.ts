import { describe, expect, it } from 'vitest';
import {
  buildCommercialDocumentsBaseCte,
  buildCommercialDocumentsListQuery,
} from './commercialDocumentsQuerySql';

describe('commercialDocumentsQuerySql Region/Site', () => {
  it('plant_site uses Discharge Destination with B2B overlay, not master_plants.group_plant', () => {
    const cte = buildCommercialDocumentsBaseCte();
    expect(cte).toContain('discharge_destination');
    expect(cte).toContain('b2b_ending_child_snapshot');
    expect(cte).not.toContain('master_plants');
    expect(cte).not.toContain('group_plant');
  });

  it('filters plant= by destinasi case-insensitively and ignores Blank', () => {
    const { sql, values } = buildCommercialDocumentsListQuery({
      plant: ['BONTANG', 'Blank'],
      page: 1,
      limit: 50,
    });
    expect(sql).toContain("UPPER(NULLIF(TRIM(e.plant_site), 'Blank'))");
    expect(values).toContain('BONTANG');
    expect(values).not.toContain('Blank');
  });

  it('empty plant filter does not restrict destinasi (including Blank rows)', () => {
    const { sql } = buildCommercialDocumentsListQuery({ page: 1, limit: 50 });
    expect(sql).not.toContain('UPPER(NULLIF(TRIM(e.plant_site)');
  });
});
