import { appendContractPerfProductSubstringSql } from './contractPerfProductFilterSql';

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
