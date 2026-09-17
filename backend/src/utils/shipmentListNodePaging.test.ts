import { describe, expect, it } from 'vitest';
import {
  canDeriveShipmentPageInNode,
  deriveShipmentPageInNode,
  nodeFilterByColumnFilters,
  nodeFilterByStatus,
  nodeSortRows,
  type NodeRow,
} from './shipmentListNodePaging';
import {
  shipmentPageCloseEffectiveStatuses,
  shipmentPageOpenEffectiveStatuses,
} from './shipmentPagePipelineSql';

/** Minimal row carrying every field the module needs, so the gate passes by default. */
function row(over: Partial<NodeRow> = {}): NodeRow {
  return {
    id: 'i1',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'SAILED',
    row_kind: 'shipment_execution',
    sto_number: '1001',
    contract_date: '2026-01-01',
    delivery_start_date: '2026-02-01',
    delivery_end_date: '2026-03-01',
    outstanding_quantity: 0,
    outstanding_qty_planning: 0,
    quantity_delivered: 0,
    quantity_delivered_klip: null,
    contract_qty: 0,
    sto_quantity: 0,
    quantity_shipped: 0,
    product: 'CPO',
    shipment_date: '2026-03-01T00:00:00.000Z',
    plant_site: 'BONTANG',
    supplier: 'S1',
    ...over,
  };
}

describe('nodeFilterByStatus', () => {
  it('OPEN and CLOSE use the same effective-status lists as the SQL', () => {
    const rows = [
      ...shipmentPageOpenEffectiveStatuses().map((s, i) => row({ id: `o${i}`, status: s })),
      ...shipmentPageCloseEffectiveStatuses().map((s, i) => row({ id: `c${i}`, status: s })),
      row({ id: 'x', status: 'UNPLANNED' }),
    ];
    expect(nodeFilterByStatus(rows, 'OPEN')).toHaveLength(
      shipmentPageOpenEffectiveStatuses().length,
    );
    expect(nodeFilterByStatus(rows, 'CLOSE')).toHaveLength(
      shipmentPageCloseEffectiveStatuses().length,
    );
  });

  it('treats a missing status param and ALL as no filter', () => {
    const rows = [row(), row({ id: 'i2', status: 'COMPLETED' })];
    expect(nodeFilterByStatus(rows, undefined)).toHaveLength(2);
    expect(nodeFilterByStatus(rows, 'ALL')).toHaveLength(2);
  });

  it('matches status case-insensitively, as the SQL comparison does', () => {
    const rows = [row({ status: 'completed' })];
    expect(nodeFilterByStatus(rows, 'CLOSE')).toHaveLength(1);
  });

  it('drops contract-backlog rows, which the filtered SQL never returns', () => {
    const rows = [
      row({ id: 'exec', status: 'COMPLETED', row_kind: 'shipment_execution' }),
      row({ id: 'exec2', status: 'COMPLETED' }),
      row({ id: 'backlog', status: 'CANCELLED', row_kind: 'contract_backlog' }),
    ];
    expect(nodeFilterByStatus(rows, 'CLOSE').map((r) => r.id)).toEqual(['exec', 'exec2']);
  });
});

describe('nodeFilterByColumnFilters', () => {
  const rows = [
    row({ id: 'a', product: 'CPO' }),
    row({ id: 'b', product: 'PKO' }),
    row({ id: 'c', product: '' }),
    row({ id: 'd', product: 'cpo' }),
  ];

  it('multi is exact and case-sensitive, mirroring `= ANY($n::text[])`', () => {
    const out = nodeFilterByColumnFilters(rows, {
      product: { type: 'multi', values: ['CPO'], includeBlank: false },
    });
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('multi includeBlank also takes empty values', () => {
    const out = nodeFilterByColumnFilters(rows, {
      product: { type: 'multi', values: ['CPO'], includeBlank: true },
    });
    expect(out.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('multi with no values and no includeBlank is a no-op, as the SQL emits nothing', () => {
    expect(nodeFilterByColumnFilters(rows, { product: { type: 'multi', values: [] } })).toHaveLength(4);
  });

  it('text exact is case-insensitive; text contains is a case-insensitive substring', () => {
    expect(
      nodeFilterByColumnFilters(rows, { product: { type: 'text', value: 'cpo', exact: true } }).map(
        (r) => r.id,
      ),
    ).toEqual(['a', 'd']);
    expect(
      nodeFilterByColumnFilters(rows, { product: { type: 'text', value: 'p' } }).map((r) => r.id),
    ).toEqual(['a', 'b', 'd']);
  });

  it('emptyOnly keeps blanks', () => {
    expect(
      nodeFilterByColumnFilters(rows, { product: { emptyOnly: true } }).map((r) => r.id),
    ).toEqual(['c']);
  });

  it('number min/max exclude nulls, as `(expr)::numeric >= $n` does', () => {
    const nums = [
      row({ id: 'n1', quantity_shipped: 10 }),
      row({ id: 'n2', quantity_shipped: 30 }),
      row({ id: 'n3', quantity_shipped: null }),
    ];
    expect(
      nodeFilterByColumnFilters(nums, { quantity_shipped: { type: 'number', min: 20 } }).map(
        (r) => r.id,
      ),
    ).toEqual(['n2']);
  });

  it('ignores date filters entirely - they are refused by the gate, not applied here', () => {
    // The SQL compares (expr)::date in the database timezone while a row carries a UTC timestamp,
    // so truncating would move range boundaries by a day. canDeriveShipmentPageInNode refuses
    // these; this asserts the filter is a no-op rather than silently wrong if one slips through.
    const dates = [
      row({ id: 'd1', shipment_date: '2026-03-01T23:59:00.000Z' }),
      row({ id: 'd2', shipment_date: '2026-03-02T00:00:00.000Z' }),
    ];
    expect(
      nodeFilterByColumnFilters(dates, { shipment_date: { type: 'date', to: '2026-03-01' } }).map(
        (r) => r.id,
      ),
    ).toEqual(['d1', 'd2']);
  });
});

describe('nodeSortRows', () => {
  it('puts nulls last in both directions', () => {
    const rows = [
      row({ id: 'null', delivery_end_date: null }),
      row({ id: 'early', delivery_end_date: '2026-01-01' }),
      row({ id: 'late', delivery_end_date: '2026-06-01' }),
    ];
    expect(nodeSortRows(rows, 'delivery_end', 'DESC').map((r) => r.id)).toEqual([
      'late',
      'early',
      'null',
    ]);
    expect(nodeSortRows(rows, 'delivery_end', 'ASC').map((r) => r.id)).toEqual([
      'early',
      'late',
      'null',
    ]);
  });

  it('breaks ties on created_at DESC then id ASC', () => {
    const rows = [
      row({ id: 'b', delivery_end_date: '2026-01-01', created_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'a', delivery_end_date: '2026-01-01', created_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'c', delivery_end_date: '2026-01-01', created_at: '2026-05-01T00:00:00.000Z' }),
    ];
    expect(nodeSortRows(rows, 'delivery_end', 'DESC').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('refuses quantity sorts, which the SQL orders by a resolved enriched expression', () => {
    // Measured: ordering these here disagreed with the SQL even though the totals matched.
    for (const key of ['outstanding_quantity', 'quantity_delivered', 'quantity_shipped']) {
      const r = canDeriveShipmentPageInNode(
        { sortKey: key, sortDir: 'DESC', statusParam: 'OPEN' },
        row(),
      );
      expect(r.ok).toBe(false);
    }
  });

  it('applies the SAP-STO-present prefix only for the UNPLANNED and PLANNED tables', () => {
    const rows = [
      row({ id: 'nosto', sto_number: '-', delivery_end_date: '2026-06-01' }),
      row({ id: 'sto', sto_number: '1001', delivery_end_date: '2026-01-01' }),
    ];
    // No status: pure date order, so the later date leads.
    expect(nodeSortRows(rows, 'delivery_end', 'DESC').map((r) => r.id)).toEqual(['nosto', 'sto']);
    // PLANNED: rows with an STO come first regardless of the date.
    expect(nodeSortRows(rows, 'delivery_end', 'DESC', 'PLANNED').map((r) => r.id)).toEqual([
      'sto',
      'nosto',
    ]);
  });

  it('leaves the order untouched for a key it cannot sort', () => {
    const rows = [row({ id: 'x' }), row({ id: 'y' })];
    expect(nodeSortRows(rows, 'vessel_name', 'ASC').map((r) => r.id)).toEqual(['x', 'y']);
  });
});

describe('canDeriveShipmentPageInNode', () => {
  const base = { sortKey: 'delivery_end', sortDir: 'DESC' as const, statusParam: 'OPEN' };

  it('accepts the common toolbar shape', () => {
    expect(
      canDeriveShipmentPageInNode(
        { ...base, statusParam: 'OPEN', colFilters: { product: { type: 'multi', values: ['CPO'] } } },
        row(),
      ),
    ).toEqual({ ok: true });
  });

  it('refuses the unfiltered list, which the hybrid merge sort orders', () => {
    const r = canDeriveShipmentPageInNode({ ...base, statusParam: undefined }, row());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('hybrid merge sort');
  });

  it('refuses a date column filter, whose boundaries shift with the timezone', () => {
    const r = canDeriveShipmentPageInNode(
      { ...base, colFilters: { shipment_date: { type: 'date', from: '2026-03-01' } } },
      row(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not mirrored');
  });

  it('refuses a status that has its own SQL resolver', () => {
    const r = canDeriveShipmentPageInNode({ ...base, statusParam: 'UNPLANNED' }, row());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('dedicated SQL path');
  });

  it('refuses a text sort, because Postgres collation is not reproduced here', () => {
    const r = canDeriveShipmentPageInNode({ ...base, sortKey: 'vessel_name' }, row());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not Node-sortable');
  });

  it('refuses a filter on a computed column such as late_indicator', () => {
    const r = canDeriveShipmentPageInNode(
      { ...base, colFilters: { late_indicator: { type: 'text', value: 'LATE' } } },
      row(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not a plain row column');
  });

  it('refuses when the rows do not carry a field the work needs', () => {
    const thin = row();
    delete (thin as Record<string, unknown>).delivery_end_date;
    const r = canDeriveShipmentPageInNode(base, thin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('delivery_end_date');
  });

  it('refuses an empty row set rather than guessing', () => {
    expect(canDeriveShipmentPageInNode(base, undefined).ok).toBe(false);
  });
});

describe('deriveShipmentPageInNode', () => {
  const rows = Array.from({ length: 45 }, (_, i) =>
    row({
      id: `r${String(i).padStart(2, '0')}`,
      status: i % 2 === 0 ? 'SAILED' : 'COMPLETED',
      delivery_end_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    }),
  );

  it('total is the filtered count, not the page length', () => {
    const out = deriveShipmentPageInNode(rows, {
      statusParam: 'CLOSE',
      sortKey: 'delivery_end',
      sortDir: 'DESC',
      page: 1,
      limit: 20,
    });
    expect(out.total).toBe(rows.filter((r) => r.status === 'COMPLETED').length);
    expect(out.rows).toHaveLength(20);
  });

  it('pages without overlap or gaps', () => {
    const args = { sortKey: 'delivery_end', sortDir: 'DESC' as const, limit: 20 };
    const p1 = deriveShipmentPageInNode(rows, { ...args, page: 1 });
    const p2 = deriveShipmentPageInNode(rows, { ...args, page: 2 });
    const p3 = deriveShipmentPageInNode(rows, { ...args, page: 3 });
    expect(p1.total).toBe(45);
    expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([20, 20, 5]);
    const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(45);
  });

  it('returns an empty page past the end', () => {
    const out = deriveShipmentPageInNode(rows, {
      sortKey: 'delivery_end',
      sortDir: 'DESC',
      page: 99,
      limit: 20,
    });
    expect(out.rows).toHaveLength(0);
    expect(out.total).toBe(45);
  });
});
