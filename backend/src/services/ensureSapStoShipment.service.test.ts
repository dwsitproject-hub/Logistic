import { describe, expect, it } from 'vitest';
import {
  buildSapStoCandidateQuery,
  isSapStoCandidateEligible,
} from './ensureSapStoShipment.service';

describe('ensureSapStoShipment.service', () => {
  it('buildSapStoCandidateQuery scopes sea incoterm and excludes existing shipments', () => {
    const { sql } = buildSapStoCandidateQuery('', 25);
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain('FROM shipments s');
    expect(sql).toContain("IS DISTINCT FROM 'T'");
    expect(sql).toContain('LIMIT 25');
  });

  it('isSapStoCandidateEligible rejects FOB Type T trucking legs', () => {
    expect(
      isSapStoCandidateEligible({
        contract: { incoterm: 'FOB' },
        shipment: { sto_no: '1016010610' },
        raw: { 'STO Type': 'T' },
      }),
    ).toBe(false);
  });

  it('isSapStoCandidateEligible accepts CIF with STO No', () => {
    expect(
      isSapStoCandidateEligible({
        contract: { incoterm: 'CIF' },
        shipment: { sto_no: '1016010610' },
        raw: {},
      }),
    ).toBe(true);
  });

  it('isSapStoCandidateEligible accepts FOB Type V sea leg', () => {
    expect(
      isSapStoCandidateEligible({
        contract: { incoterm: 'FOB' },
        shipment: { sto_no: '1016010610', vessel_name: 'BG. AS MARINA 12' },
        raw: { 'STO Type': 'V', 'Vessel Name': 'BG. AS MARINA 12' },
      }),
    ).toBe(true);
  });
});
