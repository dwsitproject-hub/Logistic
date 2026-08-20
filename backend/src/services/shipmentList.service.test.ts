import { describe, expect, it } from 'vitest';
import {
  buildShipmentListPageQuery,
  buildShipmentListStatusFilteredCountQuery,
  getCachedFilteredTotal,
  invalidateShipmentsListCache,
  normalizeShipmentListRows,
  seedShipmentListFilteredTotal,
} from './shipmentList.service';

describe('buildShipmentListStatusFilteredCountQuery', () => {
  it('counts filtered_shipments on full base CTE with toolbar + status outerSql', () => {
    const q = buildShipmentListStatusFilteredCountQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
      countShipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
      outerSql: ' AND sb.product = $3',
      innerParams: [1, 2],
      outerParams: ['CPO'],
      skipSapJoin: true,
      cacheKey: 'k',
      filterCacheKey: 'fk',
      tableStatusFilter: 'AT_DISCHARGE_PORT',
      useLiveStatusFilteredCount: true,
    });
    expect(q.text).toContain('filtered_shipments AS');
    expect(q.text).toContain('COUNT(*)::bigint AS c');
    expect(q.text).toContain("COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'");
    expect(q.text).not.toContain('paged_sto');
    expect(q.params).toEqual([1, 2, 'CPO']);
  });
});

describe('seedShipmentListFilteredTotal', () => {
  it('seeds COUNT_CACHE so status-card paging can skip a second live COUNT', () => {
    invalidateShipmentsListCache();
    const filterCacheKey = 'opt3-snapshot-gate-seed-test';
    expect(getCachedFilteredTotal(filterCacheKey)).toBeNull();
    seedShipmentListFilteredTotal(filterCacheKey, 42);
    expect(getCachedFilteredTotal(filterCacheKey)).toBe(42);
    invalidateShipmentsListCache();
    expect(getCachedFilteredTotal(filterCacheKey)).toBeNull();
  });
});

describe('buildShipmentListPageQuery', () => {
  it('selects SQL effective_status so table badges match status cards', () => {
    const q = buildShipmentListPageQuery(
      {
        shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
        outerSql: '',
        innerParams: [],
        outerParams: [],
        skipSapJoin: true,
        cacheKey: 'k',
        filterCacheKey: 'fk',
      },
      50,
      0,
    );
    expect(q.text).toContain('AS effective_status');
    expect(q.text).toContain("COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'");
    expect(q.text).toContain('sp.master_vessel_id');
    expect(q.text).toContain('vessel_name_master');
  });

  it('enriches before ORDER BY for contract_qty even when skipSapJoin is true', () => {
    const q = buildShipmentListPageQuery(
      {
        shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
        outerSql: '',
        innerParams: [],
        outerParams: [],
        skipSapJoin: true,
        cacheKey: 'k-qty',
        filterCacheKey: 'fk-qty',
        sortKey: 'contract_qty',
        sortDir: 'DESC',
      },
      20,
      0,
    );
    expect(q.text).toContain('list_enriched AS');
    expect(q.text).toContain('le.contract_qty DESC');
  });

  it('enriches before ORDER BY for outstanding_quantity even when skipSapJoin is true', () => {
    const q = buildShipmentListPageQuery(
      {
        shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
        outerSql: '',
        innerParams: [],
        outerParams: [],
        skipSapJoin: true,
        cacheKey: 'k-os',
        filterCacheKey: 'fk-os',
        sortKey: 'outstanding_quantity',
        sortDir: 'ASC',
      },
      20,
      0,
    );
    expect(q.text).toContain('list_enriched AS');
    expect(q.text).toContain('le.outstanding_quantity ASC');
    expect(q.text).not.toMatch(/ORDER BY\s+fs\.created_at ASC/);
  });
});

describe('normalizeShipmentListRows', () => {
  it('does not floor to SAILED when is_contract_sap_closed is TRUE (GR Close)', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'shipment',
        sto_number: '1016010610',
        is_contract_sap_closed: true,
        group_status_floor: 'SAILED',
        group_active_status_count: 3,
        ata_vessel_sailed_from_loading_port: '2026-05-15',
        status: 'SAILED',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('COMPLETED');
  });

  it('does not floor ATA sailed when GR is Open and members disagree', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'shipment',
        sto_number: 'STO-MIX-1',
        is_contract_sap_closed: false,
        group_status_floor: 'UNPLANNED',
        group_active_status_count: 2,
        ata_vessel_sailed_from_loading_port: '2026-07-18',
        status: 'PLANNED',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('SAILED');
  });

  it('keeps SQL effective_status when JS ATA would promote to Arrived LP', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'shipment',
        sto_number: '1006019385',
        effective_status: 'PLANNED',
        ata_vessel_arrival_at_loading_port: '2026-07-05',
        status: 'PLANNED',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('PLANNED');
    expect(rows[0]?.effective_status).toBeUndefined();
  });

  it('keeps COMPLETED on contract_backlog rows (low remaining OS)', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'contract_backlog',
        status: 'COMPLETED',
        contract_number: '1014000001',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('COMPLETED');
  });

  it('keeps PREPLANNED on contract_backlog rows', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'contract_backlog',
        status: 'PREPLANNED',
        contract_number: '1014000002',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('PREPLANNED');
  });
});
