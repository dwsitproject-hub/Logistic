import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { SapMasterV2ImportService, type FieldMetadata } from '../services/sapMasterV2Import.service';
import {
  SAP_MASTER_V2_UAT_FIELD_MAPPING,
  applySapMasterV2RawFieldAliases,
  hasSapDeleteFlag,
  isSapMasterV2UatFlatHeaderRow,
  isShipmentQuantityField,
  isTruckingQuantityField,
  resolveSapMasterV2QualityLocation,
  resolveSapTruckingQuantityDelivered,
} from './sapMasterV2UatFormat';

function headersToMetadata(headers: string[]): FieldMetadata[] {
  return headers.map((headerName, index) => ({
    columnIndex: index,
    index,
    headerName,
    sapSource1: '',
    sapSource2: '',
    userRole: '',
    isFromSap: true,
    isManualEntry: false,
    isCalculated: false,
  }));
}

describe('sapMasterV2UatFormat', () => {
  it('detects UAT flat header row', () => {
    expect(isSapMasterV2UatFlatHeaderRow(['Company Code', 'GR PO Status'])).toBe(true);
    expect(isSapMasterV2UatFlatHeaderRow(['Group', 'Supplier', 'Contract No'])).toBe(false);
  });

  it('maps UAT renamed headers to normalized keys', () => {
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['gr po status']).toBe('status');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['quantity delivery vessel']).toBe('quantity_delivery');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['quantity delivery trucking']).toBe('quantity_delivery_trucking');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['vessel loading port']).toBe('vessel_loading_port_1');
  });

  it('maps SAP Data v3 UOM, currency, and delete-status headers', () => {
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['contract qty uom']).toBe('contract_qty_uom');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['sto qty uom']).toBe('sto_qty_uom');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['delivery vessel uom']).toBe('quantity_delivery_uom');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['delivery trucking uom']).toBe('quantity_delivery_trucking_uom');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['receive uom']).toBe('quantity_receive_uom');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['b/l qty uom']).toBe('bl_quantity_uom');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['currency unit price']).toBe('currency_unit_price');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['currency trucking oa budget']).toBe(
      'currency_trucking_oa_budget',
    );
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['currency trucking oa actual']).toBe(
      'currency_trucking_oa_actual',
    );
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['delete po status']).toBe('delete_po_status');
    expect(SAP_MASTER_V2_UAT_FIELD_MAPPING['delete sto status']).toBe('delete_sto_status');
    expect(SapMasterV2ImportService.normalizeFieldNameForTest('Currency Unit Price')).toBe(
      'currency_unit_price',
    );
    expect(SapMasterV2ImportService.normalizeFieldNameForTest('Delete PO Status')).toBe(
      'delete_po_status',
    );
  });

  it('detects SAP delete flags when either PO or STO status is non-blank', () => {
    expect(hasSapDeleteFlag({ contract: { delete_po_status: 'L' } })).toBe(true);
    expect(hasSapDeleteFlag({ contract: { delete_sto_status: 'S' } })).toBe(true);
    expect(hasSapDeleteFlag({ raw: { 'Delete PO Status': 'L' } })).toBe(true);
    expect(hasSapDeleteFlag({ contract: { delete_po_status: '' }, shipment: {} })).toBe(false);
  });

  it('separates vessel vs trucking quantity columns', () => {
    expect(isShipmentQuantityField('Quantity Delivery Vessel')).toBe(true);
    expect(isTruckingQuantityField('Quantity Delivery Trucking')).toBe(true);
    expect(isShipmentQuantityField('Quantity Delivery Trucking')).toBe(false);
  });

  it('resolves UAT quality location labels', () => {
    expect(resolveSapMasterV2QualityLocation('Quality at Loading Location FFA')).toBe('Loading Port 1');
    expect(resolveSapMasterV2QualityLocation('Quality at Discharge Location M&I')).toBe('Discharge Port');
  });

  it('writes backward-compatible raw aliases', () => {
    const raw: Record<string, unknown> = {};
    applySapMasterV2RawFieldAliases(raw, 'Quantity Delivery Vessel', 100);
    applySapMasterV2RawFieldAliases(raw, 'Quantity Delivery Trucking', 50);
    expect(raw['Quantity Delivered']).toBe(100);
    expect(raw['Quantity Delivered Trucking']).toBe(50);
  });

  it('prefers trucking quantity from trucking leg when present', () => {
    const qty = resolveSapTruckingQuantityDelivered({
      shipment: { quantity_delivery: 100, quantity_delivery_trucking: 40 },
      trucking: [{ data: { quantity_delivery_trucking: 55 } }],
      raw: {},
    });
    expect(qty).toBe(55);
  });

  it('parses UAT June 2026 sample row into structured SAP buckets', () => {
    const file = path.join(__dirname, '../../../docs/UAT June 2026-3.XLSX');
    if (!fs.existsSync(file)) return;

    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      defval: '',
    }) as unknown[][];
    const headers = (rows[0] ?? []).map((h) => String(h));
    const dataRow = rows[1] ?? [];
    const parsed = SapMasterV2ImportService.parseDataRowForTest(
      dataRow,
      headersToMetadata(headers),
    ) as {
      contract: Record<string, unknown>;
      shipment: Record<string, unknown>;
      quality: Array<{ location: string; data: Record<string, unknown> }>;
      trucking: Array<{ sequence: number; data: Record<string, unknown> }>;
      raw: Record<string, unknown>;
    };

    expect(headers.length).toBe(82);
    expect(parsed.contract.status).toBeDefined();
    expect(parsed.contract.contract_ext_no).toBeDefined();
    expect(parsed.shipment.quantity_delivery).toBeDefined();
    expect(parsed.trucking[0]?.data.quantity_delivery_trucking).toBeDefined();
    expect(parsed.shipment.vessel_loading_port_1).toBeDefined();
    expect(parsed.quality.some((q) => q.location === 'Loading Port 1')).toBe(true);
    expect(parsed.quality.some((q) => q.location === 'Discharge Port')).toBe(true);
    expect(parsed.raw['Quantity Delivered']).toBeDefined();
    expect(parsed.raw['Quantity Delivered Trucking']).toBeDefined();
    expect(parsed.contract.gr_sto_status).toBeDefined();
    expect(parsed.shipment.transit_destination).toBeDefined();
    expect(parsed.shipment.discharge_destination).toBeDefined();
  });

  it('parses SAP Data v3 sample row with UOM, currency, and delete flags', () => {
    const file = path.join(__dirname, '../../../docs/SAP_Data_v3.XLSX');
    if (!fs.existsSync(file)) return;

    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      defval: '',
    }) as unknown[][];
    const headers = (rows[0] ?? []).map((h) => String(h));
    expect(headers.length).toBe(93);
    expect(isSapMasterV2UatFlatHeaderRow(headers)).toBe(true);

    const withDelete = rows.find((r, i) => {
      if (i === 0) return false;
      const poIdx = headers.indexOf('Delete PO Status');
      return poIdx >= 0 && String(r[poIdx] ?? '').trim() !== '';
    });
    const dataRow = withDelete ?? rows[1] ?? [];
    const parsed = SapMasterV2ImportService.parseDataRowForTest(
      dataRow,
      headersToMetadata(headers),
    ) as {
      contract: Record<string, unknown>;
      shipment: Record<string, unknown>;
      trucking: Array<{ data: Record<string, unknown> }>;
      raw: Record<string, unknown>;
    };

    expect(parsed.contract.contract_qty_uom).toBeDefined();
    expect(parsed.contract.currency_unit_price).toBeDefined();
    expect(parsed.shipment.quantity_delivery_uom !== undefined || parsed.raw['Delivery Vessel UoM'] !== undefined).toBe(
      true,
    );
    expect(parsed.trucking[0]?.data.quantity_delivery_trucking_uom !== undefined || parsed.raw['Delivery Trucking UoM'] !== undefined).toBe(
      true,
    );
    if (withDelete) {
      expect(hasSapDeleteFlag(parsed)).toBe(true);
      expect(
        parsed.contract.delete_po_status != null ||
          parsed.contract.delete_sto_status != null ||
          parsed.raw['Delete PO Status'] != null,
      ).toBe(true);
    }
  });
});

describe('Vessel LOA must not map to loading port', () => {
  it('normalizeFieldName maps Vessel LOA → vessel_loa', () => {
    expect(SapMasterV2ImportService.normalizeFieldNameForTest('Vessel LOA')).toBe('vessel_loa');
    expect(SapMasterV2ImportService.normalizeFieldNameForTest('Vessel LOA')).not.toBe(
      'vessel_loading_port_1',
    );
    expect(SapMasterV2ImportService.normalizeFieldNameForTest('loa')).toBe('vessel_loa');
    expect(SapMasterV2ImportService.normalizeFieldNameForTest('Vessel Loading Port')).toBe(
      'vessel_loading_port_1',
    );
  });

  it('parseDataRow puts Vessel LOA under vessel, not shipment.vessel_loading_port_1', () => {
    const meta = headersToMetadata(['Vessel Loading Port', 'Vessel LOA']);
    const parsed = SapMasterV2ImportService.parseDataRowForTest(
      ['PORT TALANG DUKU', 79.01],
      meta,
    ) as {
      shipment: Record<string, unknown>;
      vessel: Record<string, unknown>;
      raw: Record<string, unknown>;
    };
    expect(parsed.raw['Vessel Loading Port']).toBe('PORT TALANG DUKU');
    expect(parsed.raw['Vessel LOA']).toBe(79.01);
    expect(parsed.shipment.vessel_loading_port_1).toBe('PORT TALANG DUKU');
    expect(parsed.shipment.vessel_loading_port_1).not.toBe(79.01);
    expect(parsed.vessel.vessel_loa).toBe(79.01);
  });
});
