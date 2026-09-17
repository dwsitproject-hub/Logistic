import { appendContractPerfSourceTypesFilter } from '../controllers/contractSqlFragments';
import {
  appendContractPerfProductSubstringSql,
  appendContractPerfProductsMultiSql,
} from './contractPerfProductFilterSql';

describe('appendContractPerfProductSubstringSql', () => {
  it('returns ILIKE clause with wildcards', () => {
    const result = appendContractPerfProductSubstringSql('POME', 'base.product', 3);
    expect(result).toEqual({
      clause: " AND COALESCE(base.product, '') ILIKE $3",
      param: '%POME%',
      nextParamIndex: 4,
    });
  });

  it('returns null for empty or ALL', () => {
    expect(appendContractPerfProductSubstringSql('', 'base.product', 1)).toBeNull();
    expect(appendContractPerfProductSubstringSql('ALL', 'base.product', 1)).toBeNull();
    expect(appendContractPerfProductSubstringSql(undefined, 'base.product', 1)).toBeNull();
  });
});

describe('appendContractPerfProductsMultiSql', () => {
  it('OR-combines multiple product ILIKE clauses', () => {
    const result = appendContractPerfProductsMultiSql(['CPO', 'PK'], 'base.product', 2);
    expect(result?.clause).toContain(' OR ');
    expect(result?.params).toEqual(['%CPO%', '%PK%']);
    expect(result?.nextParamIndex).toBe(4);
  });
});

describe('appendContractPerfSourceTypesFilter', () => {
  it('OR-combines Interco and 3rd Party', () => {
    const sql = appendContractPerfSourceTypesFilter(['Interco', '3rd Party'], 'base.source_type');
    expect(sql).toContain(' OR ');
    expect(sql).toContain('INTERCO');
    expect(sql).toContain('3RD');
  });
});
