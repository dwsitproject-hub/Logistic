import { describe, expect, it } from 'vitest';
import {
  buildTruckingExpansionKeyOrderBy,
  buildTruckingListOrderTail,
  isTruckingListSortKey,
} from './truckingListSort';
import { buildTruckingUnplannedBacklogOrderBy } from './truckingUnplannedHybridSql';
import { sortTruckingListRows } from '../services/truckingList.service';

describe('Trucking sort stack - SQL', () => {
  it('a single sort is byte-for-byte what it was: no extra keys in either ORDER BY', () => {
    expect(buildTruckingListOrderTail('supplier', 'ASC')).toBe('supplier ASC NULLS LAST, created_at DESC, id');
    expect(buildTruckingListOrderTail('supplier', 'ASC', [])).toBe('supplier ASC NULLS LAST, created_at DESC, id');
    expect(buildTruckingExpansionKeyOrderBy('supplier', 'ASC', 'ALL', [])).toBe(
      buildTruckingExpansionKeyOrderBy('supplier', 'ASC', 'ALL'),
    );
  });

  it('extra keys sit between the primary key and the created_at / id tiebreakers', () => {
    expect(
      buildTruckingListOrderTail('incoterm', 'ASC', [
        { key: 'product', dir: 'ASC' },
        { key: 'supplier', dir: 'DESC' },
      ]),
    ).toBe('incoterm ASC NULLS LAST, product ASC NULLS LAST, supplier DESC NULLS LAST, created_at DESC, id');
  });

  it('the expansion-key ORDER BY uses the ts.* expressions and keeps ts.id last', () => {
    const orderBy = buildTruckingExpansionKeyOrderBy('incoterm', 'ASC', 'ALL', [{ key: 'product', dir: 'DESC' }]);
    expect(orderBy).toContain('ts.incoterm ASC NULLS LAST, ts.product DESC NULLS LAST, ts.created_at DESC NULLS LAST, ts.id');
  });

  it('Late Indicators and STO are valid extra keys and use their own expressions', () => {
    const orderBy = buildTruckingExpansionKeyOrderBy('supplier', 'ASC', 'ALL', [
      { key: 'late_indicator', dir: 'DESC' },
      { key: 'sto_number', dir: 'ASC' },
    ]);
    expect(orderBy).toContain("WHEN ts.delivery_end_date IS NULL THEN '-'");
    expect(orderBy).toContain('COALESCE(csla.agg_sto_lines');
    expect(isTruckingListSortKey('late_indicator')).toBe(true);
    expect(isTruckingListSortKey('sto_number')).toBe(true);
    expect(isTruckingListSortKey('1; drop table users')).toBe(false);
  });

  it('backlog rows take only the extra keys they carry, and never repeat the primary', () => {
    expect(buildTruckingUnplannedBacklogOrderBy('supplier', 'ASC')).toBe('supplier ASC NULLS LAST, contract_id ASC');
    expect(
      buildTruckingUnplannedBacklogOrderBy('incoterm', 'ASC', [
        { key: 'product', dir: 'ASC' },
        { key: 'trucking_owner', dir: 'ASC' }, // an execution-only column: left out for backlog rows
        { key: 'incoterm', dir: 'DESC' }, // the primary again: ignored
      ]),
    ).toBe('incoterm ASC NULLS LAST, product ASC NULLS LAST, contract_id ASC');
  });
});

describe('Trucking sort stack - in-memory merge', () => {
  const row = (id: string, supplier: string, product: string, incoterm: string) =>
    ({ id, supplier, product, incoterm, created_at: '2026-01-01T00:00:00Z' }) as never;
  const rows = [
    row('1', 'B', 'CPO', 'FOB'),
    row('2', 'A', 'PK', 'CIF'),
    row('3', 'A', 'CPO', 'FOB'),
    row('4', 'C', 'CPO', 'CIF'),
    row('5', 'B', 'PK', 'CIF'),
  ];
  const ids = (sorted: unknown[]) => (sorted as Array<{ id: string }>).map((r) => r.id).join('');

  it('orders by incoterm, then product, then supplier', () => {
    const sorted = sortTruckingListRows(rows, 'incoterm', 'ASC', {
      thenBy: [
        { key: 'product', dir: 'ASC' },
        { key: 'supplier', dir: 'ASC' },
      ],
    });
    expect(ids(sorted)).toBe('42531'); // CIF/CPO/C, CIF/PK/A, CIF/PK/B, FOB/CPO/A, FOB/CPO/B
  });

  it('a descending extra key reverses only the ties of the keys before it', () => {
    const sorted = sortTruckingListRows(rows, 'incoterm', 'ASC', { thenBy: [{ key: 'supplier', dir: 'DESC' }] });
    expect(ids(sorted)).toBe('45213');
  });

  it('without thenBy it is the single sort it always was', () => {
    expect(ids(sortTruckingListRows(rows, 'supplier', 'ASC'))).toBe(ids(sortTruckingListRows(rows, 'supplier', 'ASC', { thenBy: [] })));
  });
});
