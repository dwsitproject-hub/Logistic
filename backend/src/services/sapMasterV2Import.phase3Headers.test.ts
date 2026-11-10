import { describe, expect, it } from 'vitest';
import { resolveSapMasterV2QualityLocation } from '../utils/sapMasterV2UatFormat';
import { SapMasterV2ImportService } from './sapMasterV2Import.service';

/**
 * The header row of the SAP "Phase 3" template (2026-11): the 93 columns of the 2026 export plus Material Code, Material Description (after Product) and SFAL / SFBD
 * Qty and UoM (after B/L Qty UoM). Copied as SAP spells them, typos included ("Vessel Cappacity").
 */
const PHASE3_HEADERS = [
  'Plant Code', 'Company Code', 'Vendor Group', 'Supplier', 'Buyer', 'Contract Date', 'Contract Ext No', 'Contract No', 'PO No', 'STO No',
  'Contract Type', 'Contract Ref PO Initial', 'Contract Ref SO Initial', 'Product', 'Material Code', 'Material Description', 'Incoterms', 'SEA / LAND',
  'Unit Price', 'Currency Unit Price', 'Due Date Delivery (Start)', 'Due Date Delivery (End)', 'Due Date Payment', 'DP Date', 'Payoff Date', 'Source',
  'LT/SPOT', 'STO Item', 'STO Type', 'STO Classification', 'Contract Quantity', 'Contract Qty UoM', 'STO Quantity', 'STO Qty UoM',
  'Quantity Delivery Vessel', 'Delivery Vessel UoM', 'Quantity Delivery Trucking', 'Delivery Trucking UoM', 'Quantity Receive', 'Receive UoM',
  'B/L Quantity', 'B/L Qty UoM', 'SFAL Qty', 'SFAL UoM', 'SFBD Qty', 'SFBD UoM', 'GR PO Status', 'GR STO Status', 'Delete PO Status', 'Delete STO Status',
  'DP Date - Due Date', 'Payoff Date - Due Date', 'Transit Destination', 'Discharge Destination', 'Truck Loading Location', 'Truck Discharge Location',
  'Truck Transporter', 'Trucking OA Actual', 'Currency Trucking OA Actual', 'Trucking OA Budget', 'Currency Trucking OA Budget', 'Estimated KM',
  'Vessel Loading Port', 'Vessel Discharge Port', 'Vessel Name', 'Vessel Company', 'Vessel OA Actual', 'Vessel OA Budget', 'Estimated NM', 'Vessel Code',
  'Trucking Start Receive Date', 'Trucking Last Receive Date', 'ATA Vessel Arrival at Loading Port', 'ATA Vessel Berthed at Loading Port',
  'ATA Vessel Start Loading', 'ATA Vessel Completed Loading', 'ATA Vessel Sailed from Loading Port', 'ATA Vessel Arrive at Discharge Port',
  'ATA Vessel Berthed at Discharge Port', 'ATA Vessel Start Discharging', 'ATA Vessel Complete Discharge',
  'Quality at Loading Location FFA', 'Quality at Loading Location M&I', 'Quality at Loading Location DOBI', 'Quality at Loading Location RED',
  'Quality at Loading Location D&S', 'Quality at Loading Location Stone', 'Quality at Discharge Location FFA', 'Quality at Discharge Location M&I',
  'Quality at Discharge Location DOBI', 'Quality at Discharge Location RED', 'Quality at Discharge Location D&S', 'Quality at Discharge Location Stone',
  'Vessel Draft', 'Vessel LOA', 'Vessel Cappacity', 'Vessel Hull Type', 'Vessel Registration Year', 'Average Vessel Speed',
];

const keyOf = (header: string): string => (SapMasterV2ImportService as any).normalizeFieldName(header);

describe('the SAP Phase 3 template header row', () => {
  it('has the 99 columns this test was written against', () => {
    expect(PHASE3_HEADERS).toHaveLength(99);
  });

  it('maps no two headers to the same field key (a later column would overwrite an earlier one), apart from the quality columns', () => {
    // Quality at Loading / Discharge Location share a key by design: each goes into its own record, split by location (see the next test).
    const byKey = new Map<string, string[]>();
    for (const header of PHASE3_HEADERS.filter((h) => !h.startsWith('Quality at '))) {
      const key = keyOf(header);
      byKey.set(key, [...(byKey.get(key) ?? []), header]);
    }
    const collisions = [...byKey.entries()].filter(([, headers]) => headers.length > 1).map(([key, headers]) => `${key} <- ${headers.join(' | ')}`);
    expect(collisions).toEqual([]);
  });

  it('the quality columns of the two locations land in different records, so their shared keys do not overwrite each other', () => {
    for (const test of ['FFA', 'M&I', 'DOBI', 'RED', 'D&S', 'Stone']) {
      const loading = resolveSapMasterV2QualityLocation(`Quality at Loading Location ${test}`);
      const discharge = resolveSapMasterV2QualityLocation(`Quality at Discharge Location ${test}`);
      expect(loading).not.toBe(discharge);
    }
  });

  it('keeps Material Code / Description / Group apart from Product: the material is the key other applications use, the product is the commercial name', () => {
    expect(keyOf('Product')).toBe('product');
    expect(keyOf('Material Code')).toBe('material_code');
    expect(keyOf('Material Description')).toBe('material_description');
    expect(keyOf('Material Group')).toBe('material_group');
    expect(keyOf(' Material  Code ')).toBe('material_code'); // spacing in the header does not matter
  });

  it('the older flat headers that meant the product still do', () => {
    expect(keyOf('Material Desc')).toBe('product');
    expect(keyOf('Material')).toBe('product');
    expect(keyOf('Product (Material Desc)')).toBe('product');
  });

  it('SFAL / SFBD keep the keys the shipment write reads, and the vessel columns theirs', () => {
    expect(keyOf('SFAL Qty')).toBe('sfal_qty');
    expect(keyOf('SFBD Qty')).toBe('sfbd_qty');
    expect(keyOf('SFAL UoM')).toBe('sfal_uom');
    expect(keyOf('SFBD UoM')).toBe('sfbd_uom');
    expect(keyOf('Vessel Name')).toBe('vessel_name');
    expect(keyOf('Vessel Code')).toBe('vessel_code');
  });
});
