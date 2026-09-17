import { describe, expect, it } from 'vitest';
import {
  isSapSeaStoLeg,
  isSapSeaStoLegForIncoterm,
  isSapShipmentMaterializeRow,
  resolveSapStoTypeFromParsedData,
} from './sapSeaStoLeg';

describe('sapSeaStoLeg', () => {
  it('resolves STO Type from raw SAP paths', () => {
    expect(
      resolveSapStoTypeFromParsedData({
        raw: { 'STO Type': 'V' },
      }),
    ).toBe('V');
    expect(
      resolveSapStoTypeFromParsedData({
        raw: { 'STO Type': 'T' },
      }),
    ).toBe('T');
  });

  it('treats Type V as sea leg', () => {
    expect(
      isSapSeaStoLeg({
        raw: { 'STO Type': 'V', 'Vessel Name': 'MV TEST' },
        shipment: { sto_no: '1016010266' },
      }),
    ).toBe(true);
  });

  it('excludes Type T even when other fields exist', () => {
    expect(
      isSapSeaStoLeg({
        raw: { 'STO Type': 'T' },
        shipment: { sto_no: '1016010281' },
      }),
    ).toBe(false);
  });

  it('uses vessel name when STO Type is blank', () => {
    expect(
      isSapSeaStoLeg({
        raw: { 'Vessel Name': 'BG. SAHABAT SETIA 2689' },
        shipment: { sto_no: '1016010266' },
      }),
    ).toBe(true);
  });

  it('matches PO 1011002812 pattern — only V row is sea leg', () => {
    const vRow = {
      raw: {
        'STO Type': 'V',
        'Vessel Name': 'BG. SAHABAT SETIA 2689',
        'STO No.': '1016010266',
      },
      shipment: { sto_no: '1016010266', vessel_name: 'BG. SAHABAT SETIA 2689' },
    };
    const tRow = {
      raw: { 'STO Type': 'T', 'STO No.': '1016010281' },
      shipment: { sto_no: '1016010281' },
    };
    expect(isSapSeaStoLeg(vRow)).toBe(true);
    expect(isSapSeaStoLeg(tRow)).toBe(false);
  });

  it('isSapSeaStoLegForIncoterm — CIF/CFR incoterm-only (Type T allowed)', () => {
    const cifTypeT = {
      raw: { 'STO Type': 'T', 'STO No.': '1016010281' },
      shipment: { sto_no: '1016010281' },
    };
    expect(isSapSeaStoLegForIncoterm(cifTypeT, 'CIF')).toBe(true);
    expect(isSapSeaStoLegForIncoterm(cifTypeT, 'CFR')).toBe(true);
    expect(isSapSeaStoLegForIncoterm(cifTypeT, 'FOB')).toBe(false);
  });

  it('isSapShipmentMaterializeRow requires STO No but not Qty Receive for CIF', () => {
    const cifRow = {
      raw: { 'STO Type': 'T', 'STO No.': '1016010999' },
      shipment: { sto_no: '1016010999' },
    };
    expect(isSapShipmentMaterializeRow(cifRow, 'CIF')).toBe(true);
    expect(isSapShipmentMaterializeRow({ shipment: {} }, 'CIF')).toBe(false);
  });
});
