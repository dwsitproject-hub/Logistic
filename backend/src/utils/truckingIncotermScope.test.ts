import { describe, expect, it } from 'vitest';
import {
  resolveTruckingIncotermFromParsedData,
  buildTruckingPageIncotermScopeSql,
  buildTruckingPageListScopeSql,
  contractEffectiveIncotermExpr,
  isTruckingPageIncoterm,
  normalizeTruckingIncoterm,
} from './truckingIncotermScope';

describe('truckingIncotermScope', () => {
  it('normalizes incoterm labels', () => {
    expect(normalizeTruckingIncoterm(' frc ')).toBe('FRC');
    expect(isTruckingPageIncoterm('LCO')).toBe(true);
    expect(isTruckingPageIncoterm('CIF')).toBe(false);
  });

  it('resolves effective incoterm from contract with SAP fallback', () => {
    const sql = contractEffectiveIncotermExpr('c');
    expect(sql).toContain('c.incoterm');
    expect(sql).toContain('Incoterm');
    expect(sql).toContain('sap_processed_data');
  });

  it('trucking list scope is FRC/LCO incoterm only', () => {
    const sql = buildTruckingPageListScopeSql();
    expect(sql).toContain("IN ('FRC', 'LCO')");
    expect(sql).not.toContain("= 'LAND'");
  });

  it('resolves incoterm from parsed SAP row', () => {
    expect(
      resolveTruckingIncotermFromParsedData(
        { contract: { incoterm: 'lco' }, raw: { Incoterm: 'FRC' } },
        null,
      ),
    ).toBe('LCO');
    expect(
      resolveTruckingIncotermFromParsedData(
        { raw: { Incoterm: 'FRC' } },
        'CIF',
      ),
    ).toBe('CIF');
  });

  it('supports custom contract alias for incoterm guard', () => {
    const sql = buildTruckingPageIncotermScopeSql('contracts');
    expect(sql).toContain('contracts.incoterm');
    expect(sql).toContain("IN ('FRC', 'LCO')");
  });
});
