import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildShipmentContractBacklogOrderBy,
  buildShipmentContractBacklogOuterOrderBy,
  buildShipmentListEnrichedPageOrderBy,
  buildShipmentListPageOrderBy,
  isShipmentListSortKey,
  resolveShipmentListSortRequest,
  shipmentListSortStackUsesEnrichedPath,
  sortShipmentListRows,
} from './shipmentListSortSql';
import { buildRankedStoCtes, canRankStoForListSort, canUseShipmentStageSnapshotPaging, canUseShipmentStoKeyPaging } from './shipmentListStoPaging';
import { canDeriveShipmentPageInNode, nodeSortRows, type NodeRow } from './shipmentListNodePaging';
import { buildShipmentListCacheKey } from '../services/shipmentList.service';

const stack = [
  { key: 'product', dir: 'ASC' as const },
  { key: 'supplier', dir: 'DESC' as const },
];

describe('resolveShipmentListSortRequest', () => {
  it('without `sort` it is the legacy pair, parsed as before', () => {
    expect(resolveShipmentListSortRequest({ sortKey: 'supplier', sortDir: 'asc' })).toEqual({
      sortKey: 'supplier',
      sortDir: 'ASC',
      thenBy: [],
    });
    expect(resolveShipmentListSortRequest({ sortKey: 'nonsense' })).toEqual({
      sortKey: 'created_at',
      sortDir: 'DESC',
      thenBy: [],
    });
  });

  it('with `sort` the first key is primary and the rest are thenBy', () => {
    expect(resolveShipmentListSortRequest({ sort: 'incoterm:asc,product:asc,supplier:desc' })).toEqual({
      sortKey: 'incoterm',
      sortDir: 'ASC',
      thenBy: [
        { key: 'product', dir: 'ASC' },
        { key: 'supplier', dir: 'DESC' },
      ],
    });
  });

  it('drops keys the page cannot order by, including backlog-only and enriched ones it does know', () => {
    expect(isShipmentListSortKey('supplier')).toBe(true);
    expect(isShipmentListSortKey('outstanding_quantity')).toBe(true);
    expect(isShipmentListSortKey('pre_planned_group')).toBe(true);
    expect(isShipmentListSortKey('x; drop table shipments')).toBe(false);
    expect(resolveShipmentListSortRequest({ sort: 'supplier:asc,bogus:desc' }).thenBy).toEqual([]);
  });
});

describe('Shipments sort stack - execution ORDER BY', () => {
  it('a single sort is byte-for-byte what it was', () => {
    expect(buildShipmentListPageOrderBy('supplier', 'ASC', 'ALL')).toBe(
      buildShipmentListPageOrderBy('supplier', 'ASC', 'ALL', 'fs', []),
    );
    expect(buildShipmentListEnrichedPageOrderBy('contract_qty', 'DESC', 'ALL')).toBe(
      buildShipmentListEnrichedPageOrderBy('contract_qty', 'DESC', 'ALL', []),
    );
  });

  it('extra keys sit between the primary key and the created_at / id tiebreakers', () => {
    const orderBy = buildShipmentListPageOrderBy('incoterm', 'ASC', 'ALL', 'fs', stack);
    expect(orderBy).toContain(
      'fs.incoterm ASC NULLS LAST, fs.product ASC NULLS LAST, fs.supplier DESC NULLS LAST, fs.created_at DESC, fs.id ASC',
    );
  });

  it('on the enriched path the extra keys use the enriched expressions', () => {
    const orderBy = buildShipmentListEnrichedPageOrderBy('contract_qty', 'DESC', 'ALL', [
      { key: 'supplier', dir: 'ASC' },
      { key: 'outstanding_quantity', dir: 'DESC' },
    ]);
    expect(orderBy).toContain(
      'le.contract_qty DESC NULLS LAST, le.supplier ASC NULLS LAST, le.outstanding_quantity DESC NULLS LAST, le.created_at DESC, le.id ASC',
    );
  });

  it('a stack needs the enriched path when any one of its keys does', () => {
    expect(shipmentListSortStackUsesEnrichedPath('supplier', [{ key: 'product', dir: 'ASC' }])).toBe(false);
    expect(shipmentListSortStackUsesEnrichedPath('supplier', [{ key: 'contract_qty', dir: 'ASC' }])).toBe(true);
    expect(shipmentListSortStackUsesEnrichedPath('contract_qty', [])).toBe(true);
  });
});

describe('Shipments sort stack - contract backlog ORDER BY', () => {
  it('a single sort is unchanged', () => {
    expect(buildShipmentContractBacklogOrderBy('supplier', 'ASC')).toBe(
      'c.supplier ASC NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC',
    );
    expect(buildShipmentContractBacklogOrderBy('created_at', 'DESC')).toBe(
      'c.contract_date DESC NULLS LAST, c.contract_id ASC',
    );
    expect(buildShipmentContractBacklogOuterOrderBy('supplier', 'ASC')).toBe(
      'supplier ASC NULLS LAST, contract_date DESC NULLS LAST, contract_number ASC',
    );
  });

  it('extra keys come before the date and id tiebreakers', () => {
    expect(buildShipmentContractBacklogOrderBy('incoterm', 'ASC', stack)).toBe(
      'c.incoterm ASC NULLS LAST, c.product ASC NULLS LAST, c.supplier DESC NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC',
    );
    expect(buildShipmentContractBacklogOuterOrderBy('incoterm', 'ASC', stack)).toBe(
      'incoterm ASC NULLS LAST, product ASC NULLS LAST, supplier DESC NULLS LAST, contract_date DESC NULLS LAST, contract_number ASC',
    );
  });

  it('a key the backlog does not carry is left out, and the primary is never repeated', () => {
    expect(
      buildShipmentContractBacklogOrderBy('supplier', 'ASC', [
        { key: 'vessel_code', dir: 'ASC' }, // execution-only column
        { key: 'supplier', dir: 'DESC' }, // the primary again
        { key: 'product', dir: 'ASC' },
      ]),
    ).toBe('c.supplier ASC NULLS LAST, c.product ASC NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC');
  });
});

describe('Shipments sort stack - merge of hybrid rows', () => {
  const rows = [
    { id: '1', supplier: 'B', product: 'CPO', incoterm: 'FOB', created_at: '2026-01-01' },
    { id: '2', supplier: 'A', product: 'PK', incoterm: 'CIF', created_at: '2026-01-01' },
    { id: '3', supplier: 'A', product: 'CPO', incoterm: 'FOB', created_at: '2026-01-01' },
    { id: '4', supplier: 'C', product: 'CPO', incoterm: 'CIF', created_at: '2026-01-01' },
    { id: '5', supplier: 'B', product: 'PK', incoterm: 'CIF', created_at: '2026-01-01' },
  ];
  const ids = (sorted: Array<{ id: string }>) => sorted.map((r) => r.id).join('');

  it('orders by incoterm, then product, then supplier', () => {
    const sorted = sortShipmentListRows(rows, 'incoterm', 'ASC', [
      { key: 'product', dir: 'ASC' },
      { key: 'supplier', dir: 'ASC' },
    ]);
    expect(ids(sorted)).toBe('42531');
  });

  it('a descending extra key reverses only the ties of the keys before it', () => {
    expect(ids(sortShipmentListRows(rows, 'incoterm', 'ASC', [{ key: 'supplier', dir: 'DESC' }]))).toBe('45213');
  });

  it('without thenBy it is the single sort it always was', () => {
    expect(ids(sortShipmentListRows(rows, 'supplier', 'ASC'))).toBe(
      ids(sortShipmentListRows(rows, 'supplier', 'ASC', [])),
    );
  });
});

describe('Shipments sort stack - STO key paging', () => {
  it('a stack keeps the fast pager only when every key can be ranked there', () => {
    expect(canRankStoForListSort('supplier', [{ key: 'product', dir: 'ASC' }])).toBe(true);
    expect(canRankStoForListSort('supplier', [{ key: 'contract_qty', dir: 'ASC' }])).toBe(false);
    expect(canRankStoForListSort('supplier')).toBe(true);
  });

  it('ranked_sto ranks and orders by every key of the stack', () => {
    const sql = buildRankedStoCtes('s.shipment_id', '1=1', 'incoterm', 'ASC', [
      { key: 'product', dir: 'ASC' },
      { key: 'supplier', dir: 'DESC' },
    ]);
    expect(sql).toContain('AS sort_val,');
    expect(sql).toContain('AS sort_val_2,');
    expect(sql).toContain('AS sort_val_3');
    expect(sql).toContain('ORDER BY sort_val ASC NULLS LAST, sort_val_2 ASC NULLS LAST, sort_val_3 DESC NULLS LAST, mx DESC');
  });

  it('a single sort ranks exactly as before', () => {
    const sql = buildRankedStoCtes('s.shipment_id', '1=1', 'supplier', 'ASC');
    expect(sql).not.toContain('sort_val_2');
    expect(sql).toContain('ORDER BY sort_val ASC NULLS LAST, mx DESC');
  });

  it('the status snapshot orders by created_at only, so a stack never takes it', () => {
    const base = {
      summaryOnly: false,
      stoIsSet: false,
      status: 'SAILED',
      sortKey: 'created_at',
    };
    expect(canUseShipmentStageSnapshotPaging(base)).toBe(true);
    expect(canUseShipmentStageSnapshotPaging({ ...base, thenBy: [{ key: 'supplier', dir: 'ASC' }] })).toBe(false);
    expect(
      canUseShipmentStoKeyPaging({ summaryOnly: false, stoIsSet: false, status: 'ALL', sortKey: 'supplier', thenBy: [{ key: 'contract_qty', dir: 'ASC' }] }),
    ).toBe(false);
  });
});

describe('Shipments sort stack - Node-derived page', () => {
  const r = (id: string, contract: string, start: string | null, created: string): NodeRow => ({
    id,
    created_at: created,
    status: 'SAILED',
    row_kind: 'shipment_execution',
    sto_number: '1',
    contract_date: contract,
    delivery_start_date: start,
    delivery_end_date: '2026-12-31',
  });
  const rows = [
    r('a', '2026-01-02', '2026-03-01', '2026-01-01T00:00:00Z'),
    r('b', '2026-01-01', '2026-03-02', '2026-01-01T00:00:00Z'),
    r('c', '2026-01-02', '2026-03-02', '2026-01-01T00:00:00Z'),
    r('d', '2026-01-01', '2026-03-01', '2026-01-01T00:00:00Z'),
    r('e', '2026-01-02', null, '2026-01-01T00:00:00Z'),
  ];
  const ids = (sorted: NodeRow[]) => sorted.map((x) => String(x.id)).join('');

  it('orders by contract_date, then delivery_start_date, with empty values last', () => {
    expect(ids(nodeSortRows(rows, 'contract_date', 'ASC', 'OPEN', [{ key: 'delivery_start_date', dir: 'ASC' }]))).toBe('dbace');
  });

  it('a descending extra key flips only the ties of the key before it, and NULLS LAST still holds', () => {
    expect(ids(nodeSortRows(rows, 'contract_date', 'ASC', 'OPEN', [{ key: 'delivery_start_date', dir: 'DESC' }]))).toBe('bdcae');
  });

  it('without thenBy it is the single sort it always was', () => {
    expect(ids(nodeSortRows(rows, 'contract_date', 'ASC', 'OPEN'))).toBe(
      ids(nodeSortRows(rows, 'contract_date', 'ASC', 'OPEN', [])),
    );
  });

  it('a stack with a key Node cannot order identically to SQL stays on SQL', () => {
    const gate = canDeriveShipmentPageInNode(
      { statusParam: 'OPEN', sortKey: 'contract_date', sortDir: 'ASC', thenBy: [{ key: 'supplier', dir: 'ASC' }] },
      rows[0],
    );
    expect(gate.ok).toBe(false);
    const ok = canDeriveShipmentPageInNode(
      { statusParam: 'OPEN', sortKey: 'contract_date', sortDir: 'ASC', thenBy: [{ key: 'delivery_start_date', dir: 'ASC' }] },
      rows[0],
    );
    expect(ok.ok).toBe(true);
  });
});

describe('Shipments sort stack - cache keys', () => {
  const base = { plants: [] as string[], globalSearch: '', colFilters: {}, skipSapJoin: false, sortKey: 'supplier', sortDir: 'ASC' };

  it('a single sort keeps its cache key; a stack gets its own', () => {
    const single = buildShipmentListCacheKey(base);
    expect(buildShipmentListCacheKey({ ...base, thenBy: [] })).toBe(single);
    expect(buildShipmentListCacheKey({ ...base, thenBy: stack })).not.toBe(single);
    expect(buildShipmentListCacheKey({ ...base, thenBy: stack })).not.toBe(
      buildShipmentListCacheKey({ ...base, thenBy: [stack[0]] }),
    );
  });
});

describe('the frontend list of stackable Shipments columns', () => {
  // The client stacks only keys on this list, because the server drops a key it does not know from a stack and that
  // would silently change which column is primary. So every key on it must be one the server accepts.
  const src = readFileSync(
    join(__dirname, '..', '..', '..', 'frontend', 'src', 'lib', 'shipmentsSortStack.ts'),
    'utf8',
  );
  const block = src.slice(src.indexOf('new Set(['), src.indexOf('])', src.indexOf('new Set([')));
  const keys = [...block.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);

  it('finds the list', () => {
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toContain('supplier');
  });

  it('every key on it is accepted by the server', () => {
    const unknown = keys.filter((k) => !isShipmentListSortKey(k));
    expect(unknown).toEqual([]);
  });
});
