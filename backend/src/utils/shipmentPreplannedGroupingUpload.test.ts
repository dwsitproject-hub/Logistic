import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  clusterShipmentGroupingRowsByGroup,
  isSelectY,
  matchGroupingRowsToContracts,
  parseShipmentGroupingMatrix,
  SHIPMENT_GROUPING_INSTRUCTION,
  SHIPMENT_GROUPING_TEMPLATE_HEADERS,
} from './shipmentPreplannedGroupingUpload';
import {
  sqlGroupingTemplatePlantSiteRawExpr,
  SHIPMENT_GROUPING_TEMPLATE_ROW_LIMIT,
} from './shipmentPreplannedGroupingTemplateSql';

describe('shipmentPreplannedGroupingUpload parse', () => {
  it('does not use WILMAR examples or contract number columns', () => {
    expect(SHIPMENT_GROUPING_INSTRUCTION).not.toMatch(/WILMAR/i);
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Contract Ext No');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Contract No');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('PO Number');
  });

  it('skips rows without Y even if Group is leftover', () => {
    const parsed = parseShipmentGroupingMatrix([
      [...SHIPMENT_GROUPING_TEMPLATE_HEADERS],
      ['', 'A', 'Astra', 'BONTANG', 'CPO', 'CIF', 'KPN', '1001', '2026-01-01', '100', '90', 'Unplanned'],
      ['Y', 'A', 'Astra', 'BONTANG', 'CPO', 'CIF', 'KPN', '1002', '2026-01-01', '100', '90', 'Unplanned'],
    ]);
    expect(parsed.selectedRows).toHaveLength(1);
    expect(parsed.selectedRows[0]?.poNumber).toBe('1002');
    expect(parsed.skippedWithoutY).toBe(1);
  });

  it('requires Group when Select is Y', () => {
    const parsed = parseShipmentGroupingMatrix([
      ['Select', 'Group', 'PO Number'],
      ['Y', '  ', '1001'],
    ]);
    expect(parsed.selectedRows).toHaveLength(0);
    expect(parsed.issues[0]?.reason).toBe('isi Group');
  });

  it('clusters by Group and flags single-PO groups in matching', () => {
    const clusters = clusterShipmentGroupingRowsByGroup([
      {
        excelRowNumber: 3,
        selectY: true,
        group: 'A',
        poNumber: '1',
        supplier: 'S',
      },
      {
        excelRowNumber: 4,
        selectY: true,
        group: 'A',
        poNumber: '2',
        supplier: 'S',
      },
      {
        excelRowNumber: 5,
        selectY: true,
        group: 'B',
        poNumber: '3',
        supplier: 'S',
      },
    ]);
    expect(clusters.find((c) => c.group === 'A')?.rows).toHaveLength(2);
    expect(clusters.find((c) => c.group === 'B')?.rows).toHaveLength(1);
  });

  it('matches by PO Number only and rejects ineligible POs', () => {
    const matches = matchGroupingRowsToContracts(
      [
        {
          excelRowNumber: 3,
          selectY: true,
          group: '1',
          poNumber: '1001',
          supplier: '',
        },
        {
          excelRowNumber: 4,
          selectY: true,
          group: '1',
          poNumber: '9999',
          supplier: '',
        },
      ],
      [{ id: 'u1', poNumber: '1001' }],
    );
    expect(matches[0]).toMatchObject({ ok: true, contractId: 'u1' });
    expect(matches[1]?.ok).toBe(false);
    expect(isSelectY('Y')).toBe(true);
    expect(isSelectY('YES')).toBe(false);
  });
});

describe('shipmentPreplannedGroupingTemplateSql snapshots', () => {
  it('reads Region/Plant from snapshot discharge dest + B2B snapshot, not sap_processed_data', () => {
    const sql = sqlGroupingTemplatePlantSiteRawExpr();
    expect(sql).toContain('b2b_ending_child_snapshot');
    expect(sql).toContain('l.discharge_destination');
    expect(sql).not.toContain('sap_processed_data');
    expect(sql).toContain('KIJING');
  });
});

vi.mock('../database/connection', () => ({
  query: vi.fn(),
  default: { connect: vi.fn() },
}));

vi.mock('../services/contractLatestSpdSnapshot.service', () => ({
  isContractLatestSpdSnapshotFresh: vi.fn(async () => true),
}));

vi.mock('../services/contractQtyMoveSnapshot.service', () => ({
  resolveContractsQtyMoveCte: vi.fn(async () => {
    return `qty_move AS (
        SELECT
          s.contract_number,
          s.quantity_delivery_trucking,
          s.quantity_delivery_vessel,
          s.quantity_receive,
          s.quantity_delivery
        FROM contract_qty_move_snapshot s
        WHERE s.contract_number IN (SELECT contract_id FROM backlog_contract_ids)
      )`;
  }),
}));

describe('buildShipmentGroupingTemplateQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses one snapshot query, template columns, supplier sort, and a hard cap', async () => {
    const { buildShipmentGroupingTemplateQuery } = await import(
      './shipmentPreplannedGroupingTemplateSql'
    );
    const { sql, limit } = await buildShipmentGroupingTemplateQuery({
      plants: [],
      search: '',
      columnFilters: {},
    });
    expect(limit).toBe(SHIPMENT_GROUPING_TEMPLATE_ROW_LIMIT);
    expect(sql).toContain('contract_latest_spd_snapshot');
    expect(sql).toContain('contract_qty_move_snapshot');
    expect(sql).toContain('AS plant_site');
    expect(sql).toContain('AS po_number');
    expect(sql).toContain('AS contract_qty_kg');
    expect(sql).toContain('AS outstanding_qty_kg');
    expect(sql).toContain("LOWER(TRIM(COALESCE(c.supplier, ''))) ASC");
    expect(sql).toContain(`LIMIT ${SHIPMENT_GROUPING_TEMPLATE_ROW_LIMIT + 1}`);
    expect(sql).toContain('l.discharge_destination');
    expect(sql).toContain('b2b_ending_child_snapshot');
    expect(sql).not.toContain('AS contract_ext_no');
    expect(sql).not.toContain('AS contract_number');
  });

  it('prefetch identity SQL is a single eligible Unplanned query', async () => {
    const { buildManualGroupingEligibleIdentityQuery } = await import(
      './shipmentPreplannedGroupingTemplateSql'
    );
    const { sql, params } = await buildManualGroupingEligibleIdentityQuery();
    expect(params).toEqual([]);
    expect(sql).toContain('contract_latest_spd_snapshot');
    expect(sql).toContain('po_number');
    expect(sql).not.toContain('AS contract_ext_no');
  });
});
