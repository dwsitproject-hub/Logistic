import { describe, expect, it } from 'vitest';
import {
  buildShipmentContractBacklogOrderBy,
  buildShipmentContractBacklogOuterOrderBy,
  buildShipmentListEnrichedCteBody,
  buildShipmentListEnrichedPageOrderBy,
  buildShipmentListPageOrderBy,
  parseShipmentListSort,
  sortShipmentListRows,
  SHIPMENT_LIST_ENRICHED_SORT_KEYS,
  SHIPMENT_LIST_SORT_COLUMNS,
  shipmentListSortUsesEnrichedPath,
} from './shipmentListSortSql';
import { buildListOrderByWithSapStoPriority } from './listSapStoPrioritySql';

describe('shipmentListSortSql', () => {
  describe('parseShipmentListSort', () => {
    it('defaults to created_at DESC', () => {
      expect(parseShipmentListSort(undefined, undefined)).toEqual({
        sortKey: 'created_at',
        sortDir: 'DESC',
      });
    });

    it('accepts whitelisted sort keys and asc direction', () => {
      expect(parseShipmentListSort('vessel_name', 'asc')).toEqual({
        sortKey: 'vessel_name',
        sortDir: 'ASC',
      });
    });

    it('accepts enriched-only qty sort keys', () => {
      expect(parseShipmentListSort('outstanding_quantity', 'asc').sortKey).toBe(
        'outstanding_quantity',
      );
      expect(parseShipmentListSort('quantity_receive', 'desc').sortKey).toBe('quantity_receive');
    });

    it('accepts frontend delivery date aliases', () => {
      expect(parseShipmentListSort('delivery_start', 'asc').sortKey).toBe('delivery_start');
      expect(parseShipmentListSort('delivery_end', 'asc').sortKey).toBe('delivery_end');
    });

    it('falls back for unknown sort keys', () => {
      expect(parseShipmentListSort('not_a_column', 'desc').sortKey).toBe('created_at');
      expect(parseShipmentListSort('pre_planned_group', 'desc').sortKey).toBe('created_at');
    });
  });

  describe('shipmentListSortUsesEnrichedPath', () => {
    it('flags SAP/qty columns that need enriched sort', () => {
      expect(shipmentListSortUsesEnrichedPath('outstanding_quantity')).toBe(true);
      expect(shipmentListSortUsesEnrichedPath('quantity_delivered')).toBe(true);
      expect(shipmentListSortUsesEnrichedPath('quantity_receive')).toBe(true);
      expect(shipmentListSortUsesEnrichedPath('contract_qty')).toBe(true);
      expect(shipmentListSortUsesEnrichedPath('loading_port')).toBe(true);
      expect(shipmentListSortUsesEnrichedPath('vessel_name')).toBe(false);
    });

    it('ENRICHED_SORT_KEYS match usesEnrichedPath', () => {
      for (const key of SHIPMENT_LIST_ENRICHED_SORT_KEYS) {
        expect(shipmentListSortUsesEnrichedPath(key)).toBe(true);
      }
    });
  });

  describe('buildShipmentListPageOrderBy', () => {
    it('orders by vessel_name when requested', () => {
      const orderBy = buildShipmentListPageOrderBy('vessel_name', 'ASC');
      expect(orderBy).toContain(SHIPMENT_LIST_SORT_COLUMNS.vessel_name);
      expect(orderBy).toContain('ASC');
      expect(orderBy).toContain('fs.created_at DESC');
    });

    it('prioritizes SAP STO rows on UNPLANNED before vessel sort', () => {
      const orderBy = buildShipmentListPageOrderBy('vessel_name', 'ASC', 'UNPLANNED');
      expect(orderBy).toBe(
        buildListOrderByWithSapStoPriority(
          'fs.sto_number',
          `${SHIPMENT_LIST_SORT_COLUMNS.vessel_name} ASC NULLS LAST, fs.created_at DESC, fs.id ASC`,
          'UNPLANNED',
        ),
      );
    });

    it('ends every sort in a unique key so tied rows cannot reshuffle between plans', () => {
      // created_at is not unique - a bulk SAP load stamps thousands of rows with the same
      // microsecond - so without a final unique key the query plan, not the data, decides which
      // of the tied rows lands on page 1. Restoring this database into PostgreSQL 18 returned
      // the same rows with a different page 1 for exactly this reason.
      for (const sortKey of Object.keys(SHIPMENT_LIST_SORT_COLUMNS)) {
        for (const sortDir of ['ASC', 'DESC'] as const) {
          expect(buildShipmentListPageOrderBy(sortKey, sortDir)).toContain('fs.id ASC');
        }
      }
    });

    it('skips STO priority when sorting by contract_date', () => {
      const orderBy = buildShipmentListPageOrderBy('contract_date', 'ASC', 'UNPLANNED');
      expect(orderBy).toBe('fs.contract_date ASC NULLS LAST, fs.created_at DESC, fs.id ASC');
      expect(orderBy).not.toContain('CASE');
    });
  });

  describe('buildShipmentListEnrichedPageOrderBy', () => {
    it('sorts outstanding qty on enriched column', () => {
      const orderBy = buildShipmentListEnrichedPageOrderBy('outstanding_quantity', 'DESC');
      expect(orderBy).toContain('le.outstanding_quantity DESC');
    });

    it('sorts delivery qty on KLIP/SAP resolved column', () => {
      const orderBy = buildShipmentListEnrichedPageOrderBy('quantity_delivered', 'ASC');
      expect(orderBy).toContain('le.resolved_quantity_delivered ASC');
    });

    it('sorts receive qty on resolved receive column', () => {
      const orderBy = buildShipmentListEnrichedPageOrderBy('quantity_receive', 'ASC');
      expect(orderBy).toContain('le.resolved_quantity_receive ASC');
    });
  });

  describe('shell qty sort columns', () => {
    it('orders delivery/receive by KLIP proxies without enriched path', () => {
      const delivery = buildShipmentListPageOrderBy('quantity_delivered', 'DESC');
      expect(delivery).toContain('quantity_delivered_klip');
      expect(delivery).not.toContain('list_enriched');
      const receive = buildShipmentListPageOrderBy('quantity_receive', 'ASC');
      expect(receive).toContain('actual_vessel_qty_receive');
    });
  });

  describe('buildShipmentListEnrichedCteBody', () => {
    it('includes resolved qty + port sort helpers', () => {
      const sql = buildShipmentListEnrichedCteBody('1::numeric AS contract_qty');
      expect(sql).toContain('list_enriched AS');
      expect(sql).toContain('resolved_quantity_delivered');
      expect(sql).toContain('resolved_quantity_receive');
      expect(sql).toContain('loading_ports_sort');
      expect(sql).toContain('contract_qty');
    });
  });

  describe('buildShipmentContractBacklogOrderBy', () => {
    it('uses contract_date for default created_at sort', () => {
      expect(buildShipmentContractBacklogOrderBy('created_at', 'DESC')).toBe(
        'c.contract_date DESC NULLS LAST, c.contract_id ASC',
      );
    });

    it('sorts contract backlog by po_numbers when requested', () => {
      const orderBy = buildShipmentContractBacklogOrderBy('po_numbers', 'ASC');
      expect(orderBy).toContain('c.po_number ASC');
    });

    it('sorts contract backlog by outstanding_quantity output column', () => {
      expect(buildShipmentContractBacklogOrderBy('outstanding_quantity', 'DESC')).toBe(
        'outstanding_quantity DESC NULLS LAST, c.contract_date DESC NULLS LAST, c.contract_id ASC',
      );
    });

    it('does not ORDER BY a string literal when sortKey is status', () => {
      const orderBy = buildShipmentContractBacklogOrderBy('status', 'ASC');
      expect(orderBy).not.toMatch(/'UNPLANNED'/);
      expect(orderBy).not.toMatch(/ORDER BY\s+'/);
      expect(orderBy).toBe('c.contract_date ASC NULLS LAST, c.contract_id ASC');
    });
  });

  describe('sortShipmentListRows', () => {
    it('sorts merged hybrid rows by outstanding qty descending', () => {
      const sorted = sortShipmentListRows(
        [
          { outstanding_quantity: 100, created_at: '2026-01-01' },
          { outstanding_quantity: 5000, created_at: '2026-01-02' },
          { outstanding_quantity: 250, created_at: '2026-01-03' },
        ],
        'outstanding_quantity',
        'DESC',
      );
      expect(sorted.map((r) => r.outstanding_quantity)).toEqual([5000, 250, 100]);
    });

    it('sorts delivery qty using resolved column when present', () => {
      const sorted = sortShipmentListRows(
        [
          { quantity_delivered: 10, resolved_quantity_delivered: 1000 },
          { quantity_delivered: 9000, resolved_quantity_delivered: 200 },
        ],
        'quantity_delivered',
        'DESC',
      );
      expect(sorted[0]?.resolved_quantity_delivered).toBe(1000);
    });

    it('sorts by contract_date chronologically (not string/numeric)', () => {
      const sorted = sortShipmentListRows(
        [
          { contract_date: '2026-01-15', id: 'a' },
          { contract_date: '2025-12-01', id: 'b' },
          { contract_date: '2026-03-01', id: 'c' },
        ],
        'contract_date',
        'ASC',
      );
      expect(sorted.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    });
  });

  describe('buildShipmentContractBacklogOuterOrderBy', () => {
    it('uses output column names without contracts alias', () => {
      expect(buildShipmentContractBacklogOuterOrderBy('created_at', 'DESC')).toBe(
        'contract_date DESC NULLS LAST, contract_number ASC',
      );
      expect(buildShipmentContractBacklogOuterOrderBy('vessel_name', 'DESC')).toContain(
        'contract_date DESC',
      );
      expect(buildShipmentContractBacklogOuterOrderBy('vessel_name', 'DESC')).not.toContain('c.');
    });

    it('sorts backlog rows by outstanding_quantity output column', () => {
      const orderBy = buildShipmentContractBacklogOuterOrderBy('outstanding_quantity', 'DESC');
      expect(orderBy).toContain('outstanding_quantity DESC');
    });

    it('orders ALL-hybrid backlog by status column, not a string literal', () => {
      const orderBy = buildShipmentContractBacklogOuterOrderBy('status', 'ASC');
      expect(orderBy).toContain('status ASC');
      expect(orderBy).not.toMatch(/'UNPLANNED'/);
      expect(orderBy).not.toMatch(/^\d+/);
    });
  });
});
