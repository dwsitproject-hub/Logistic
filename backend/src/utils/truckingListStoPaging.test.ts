import { describe, expect, it } from 'vitest';
import { canUseTruckingStoKeyPaging } from './truckingListStoPaging';
import { buildTruckingListExpansionSql } from './truckingListStoExpandSql';

describe('truckingListStoPaging', () => {
  it('canUseTruckingStoKeyPaging allows toolbar-only scope', () => {
    expect(
      canUseTruckingStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        contractIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: {},
      }),
    ).toBe(true);
  });

  it('canUseTruckingStoKeyPaging blocks status card filters', () => {
    expect(
      canUseTruckingStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        contractIsSet: false,
        status: 'PLANNED',
      }),
    ).toBe(false);
  });

  it('canUseTruckingStoKeyPaging blocks global search', () => {
    expect(
      canUseTruckingStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        contractIsSet: false,
        status: 'ALL',
        globalSearch: 'STO-123',
      }),
    ).toBe(false);
  });

  it('expansion paging injects expansion_keys and paged_expansion CTEs', () => {
    const sql = buildTruckingListExpansionSql('SELECT 1 AS id', {
      skipSapJoin: true,
      expansionPaging: {
        limit: 20,
        offset: 0,
        orderBySql: 'ts.created_at DESC',
      },
    });
    expect(sql).toContain('expansion_keys AS');
    expect(sql).toContain('ranked_expansion AS');
    expect(sql).toContain('paged_expansion AS');
    expect(sql).toContain('INNER JOIN paged_expansion pe');
    expect(sql).toContain('FROM expansion_keys) AS __filter_total');
  });
});
