import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildShipmentGroupingTemplateXlsxBuffer,
  clusterShipmentGroupingRowsByGroup,
  isSelectY,
  matchGroupingRowsToContracts,
  parseShipmentGroupingMatrix,
  SHIPMENT_GROUPING_INSTRUCTION,
  SHIPMENT_GROUPING_LISTS_SHEET_NAME,
  SHIPMENT_GROUPING_SHEET_NAME,
  SHIPMENT_GROUPING_TEMPLATE_HEADERS,
  SHIPMENT_GROUPING_VESSEL_LIST_NAME,
  type ParsedShipmentGroupingRow,
} from './shipmentPreplannedGroupingUpload';
import { emptyGroupingEtas } from './shipmentGroupingEtaColumns';
import {
  sqlGroupingTemplatePlantSiteRawExpr,
  SHIPMENT_GROUPING_TEMPLATE_ROW_LIMIT,
} from './shipmentPreplannedGroupingTemplateSql';

function selected(
  over: Partial<ParsedShipmentGroupingRow> & Pick<ParsedShipmentGroupingRow, 'excelRowNumber' | 'group'>,
): ParsedShipmentGroupingRow {
  return {
    selectY: true,
    poNumber: '',
    supplier: '',
    incoterm: '',
    outstandingQtyMt: null,
    vessel: '',
    qtyDeliveryMt: null,
    etas: emptyGroupingEtas(),
    ...over,
  };
}

describe('shipmentPreplannedGroupingUpload parse', () => {
  it('does not use WILMAR examples or contract number columns', () => {
    expect(SHIPMENT_GROUPING_INSTRUCTION).not.toMatch(/WILMAR/i);
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Contract Ext No');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Contract No');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('PO Number');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('Vessel');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('Qty Delivery (MT)');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS.indexOf('Qty Delivery (MT)')).toBe(
      SHIPMENT_GROUPING_TEMPLATE_HEADERS.indexOf('Vessel') + 1,
    );
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).toContain('Arr. @ LP');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Charter Type');
    expect(SHIPMENT_GROUPING_TEMPLATE_HEADERS).not.toContain('Loading Port');
    expect(SHIPMENT_GROUPING_INSTRUCTION).toMatch(/Preplanned/);
    expect(SHIPMENT_GROUPING_INSTRUCTION).toMatch(/Planned/);
    expect(SHIPMENT_GROUPING_INSTRUCTION).toMatch(/Qty Delivery \(MT\) opsional/);
    expect(SHIPMENT_GROUPING_INSTRUCTION).toMatch(/Qty Delivery \(Klip\)/);
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

  it('clusters by Group including a single-PO group', () => {
    const clusters = clusterShipmentGroupingRowsByGroup([
      selected({ excelRowNumber: 3, group: 'A', poNumber: '1', supplier: 'S' }),
      selected({ excelRowNumber: 4, group: 'A', poNumber: '2', supplier: 'S' }),
      selected({ excelRowNumber: 5, group: 'B', poNumber: '3', supplier: 'S' }),
    ]);
    expect(clusters.find((c) => c.group === 'A')?.rows).toHaveLength(2);
    expect(clusters.find((c) => c.group === 'B')?.rows).toHaveLength(1);
  });

  it('matches by PO Number only and rejects ineligible POs', () => {
    const matches = matchGroupingRowsToContracts(
      [
        selected({ excelRowNumber: 3, group: '1', poNumber: '1001' }),
        selected({ excelRowNumber: 4, group: '1', poNumber: '9999' }),
      ],
      [{ id: 'u1', poNumber: '1001' }],
    );
    expect(matches[0]).toMatchObject({ ok: true, contractId: 'u1' });
    expect(matches[1]?.ok).toBe(false);
    expect(isSelectY('Y')).toBe(true);
    expect(isSelectY('YES')).toBe(false);
  });

  it('parses Vessel and ETA dates from Select=Y rows', () => {
    const headers = [...SHIPMENT_GROUPING_TEMPLATE_HEADERS];
    const row = headers.map(() => '');
    row[0] = 'Y';
    row[1] = 'A';
    row[7] = '1001';
    row[12] = 'GIAT ARMADA 02';
    row[13] = '1500';
    row[14] = '2026-07-01';
    const parsed = parseShipmentGroupingMatrix([headers, row]);
    expect(parsed.selectedRows[0]?.vessel).toBe('GIAT ARMADA 02');
    expect(parsed.selectedRows[0]?.qtyDeliveryMt).toBe(1500);
    expect(parsed.selectedRows[0]?.etas.eta_arrival).toBe('2026-07-01');
  });

  it('treats Qty Delivery as optional and rejects invalid numbers', () => {
    const headers = [...SHIPMENT_GROUPING_TEMPLATE_HEADERS];
    const okRow = headers.map(() => '');
    okRow[0] = 'Y';
    okRow[1] = 'A';
    okRow[7] = '1001';
    okRow[12] = 'GIAT ARMADA 02';
    const parsedOk = parseShipmentGroupingMatrix([headers, okRow]);
    expect(parsedOk.selectedRows[0]?.qtyDeliveryMt).toBeNull();

    const zeroRow = [...okRow];
    zeroRow[7] = '1003';
    zeroRow[13] = '0';
    const parsedZero = parseShipmentGroupingMatrix([headers, zeroRow]);
    expect(parsedZero.selectedRows[0]?.qtyDeliveryMt).toBeNull();

    const badRow = [...okRow];
    badRow[7] = '1002';
    badRow[13] = 'abc';
    const parsedBad = parseShipmentGroupingMatrix([headers, badRow]);
    expect(parsedBad.selectedRows).toHaveLength(0);
    expect(parsedBad.issues[0]?.reason).toMatch(/Qty Delivery/i);
  });

  it('embeds Master Vessel sheet and named-range list validation on the Vessel column', () => {
    const buf = buildShipmentGroupingTemplateXlsxBuffer([], { vesselNames: ['ALPHA STAR', 'BETA'] });
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain(SHIPMENT_GROUPING_LISTS_SHEET_NAME);
    expect(wb.SheetNames).toContain(SHIPMENT_GROUPING_SHEET_NAME);
    const master = XLSX.utils.sheet_to_json(wb.Sheets[SHIPMENT_GROUPING_LISTS_SHEET_NAME]!, {
      header: 1,
      defval: '',
    }) as unknown[][];
    expect(master.flat()).toContain('ALPHA STAR');
    expect(master.flat()).toContain('BETA');

    const names = (wb.Workbook as { Names?: Array<{ Name?: string; Ref?: string }> } | undefined)?.Names ?? [];
    const vesselList = names.find((n) => n.Name === SHIPMENT_GROUPING_VESSEL_LIST_NAME);
    expect(vesselList?.Ref).toMatch(/Master Vessel/);
    expect(vesselList?.Ref).toMatch(/\$A\$2:\$A\$3/);

    const CFB = require('cfb') as typeof import('cfb');
    const cfb = CFB.read(buf, { type: 'buffer' });
    const path =
      cfb.FullPaths.find((p) => p.replace(/\\/g, '/').includes('xl/worksheets/sheet1.xml')) ?? '';
    const entry = CFB.find(cfb, path);
    const xml = Buffer.from(entry?.content as Uint8Array).toString('utf8');
    expect(xml).toContain('type="list"');
    expect(xml).toContain(`<formula1>${SHIPMENT_GROUPING_VESSEL_LIST_NAME}</formula1>`);
    expect(xml).toMatch(/sqref="M3:M\d+"/);
    expect(xml.indexOf('<dataValidations')).toBeLessThan(xml.indexOf('<ignoredErrors'));
    const wbXmlPath =
      cfb.FullPaths.find((p) => p.replace(/\\/g, '/').includes('xl/workbook.xml')) ?? '';
    const wbEntry = CFB.find(cfb, wbXmlPath);
    const wbXml = Buffer.from(wbEntry?.content as Uint8Array).toString('utf8');
    expect(wbXml).toContain(`name="${SHIPMENT_GROUPING_VESSEL_LIST_NAME}"`);
    expect(wbXml).toContain('Master Vessel');
    expect(wbXml).toMatch(/name="Master Vessel"[^>]*state="hidden"/);
    const help = XLSX.utils.sheet_to_json(wb.Sheets['Cara isi']!, {
      header: 1,
      defval: '',
    }) as unknown[][];
    expect(help.flat().join(' ')).toMatch(/sheet Master Vessel/);
    expect(help.flat().join(' ')).toMatch(/Qty Delivery \(MT\)/);
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
