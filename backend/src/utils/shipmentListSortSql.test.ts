import { describe, expect, it } from 'vitest';
import {
  buildShipmentContractBacklogOrderBy,
  buildShipmentContractBacklogOuterOrderBy,
  buildShipmentListPageOrderBy,
  parseShipmentListSort,
  SHIPMENT_LIST_SORT_COLUMNS,
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

    it('falls back for unknown sort keys', () => {
      expect(parseShipmentListSort('not_a_column', 'desc').sortKey).toBe('created_at');
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
  });
});
