import { describe, expect, it } from 'vitest';
import { emptyGroupingEtas } from './shipmentGroupingEtaColumns';
import {
  charterTypeFromMasterTerms,
  classifyGroupingClusterMode,
  mergeClusterVoyageFields,
} from './shipmentGroupingPlannedClassify';

function allEtas(date = '2026-07-01') {
  const etas = emptyGroupingEtas();
  for (const key of Object.keys(etas) as Array<keyof typeof etas>) {
    etas[key] = date;
  }
  return etas;
}

describe('shipmentGroupingPlannedClassify', () => {
  it('maps master vessel terms to V/C or T/C only', () => {
    expect(charterTypeFromMasterTerms('V/C')).toBe('V/C');
    expect(charterTypeFromMasterTerms('t/c')).toBe('T/C');
    expect(charterTypeFromMasterTerms('CIF')).toBe('');
    expect(charterTypeFromMasterTerms(null)).toBe('');
  });

  it('classifies Select+Group only as preplanned', () => {
    const classified = classifyGroupingClusterMode({
      fields: { vessel: '', etas: emptyGroupingEtas() },
      allCif: false,
    });
    expect(classified.mode).toBe('preplanned');
  });

  it('classifies vessel + all ETAs as planned without Qty Delivery', () => {
    const classified = classifyGroupingClusterMode({
      fields: { vessel: 'GIAT ARMADA 02', etas: allEtas() },
      allCif: false,
    });
    expect(classified.mode).toBe('planned');
  });

  it('rejects vessel without complete ETAs for non-CIF', () => {
    const etas = emptyGroupingEtas();
    etas.eta_arrival = '2026-07-01';
    const classified = classifyGroupingClusterMode({
      fields: { vessel: 'GIAT ARMADA 02', etas },
      allCif: false,
    });
    expect(classified.mode).toBe('reject');
  });

  it('allows CIF groups with vessel and no ETAs as planned', () => {
    const classified = classifyGroupingClusterMode({
      fields: { vessel: 'GIAT ARMADA 02', etas: emptyGroupingEtas() },
      allCif: true,
    });
    expect(classified.mode).toBe('planned');
  });

  it('rejects ETAs without vessel', () => {
    const classified = classifyGroupingClusterMode({
      fields: { vessel: '', etas: allEtas() },
      allCif: false,
    });
    expect(classified.mode).toBe('reject');
    expect(classified.reason).toMatch(/Vessel is empty/i);
  });

  it('merges first non-empty vessel and rejects conflicting names', () => {
    const ok = mergeClusterVoyageFields([
      { vessel: '', etas: emptyGroupingEtas() },
      { vessel: 'ALPHA', etas: emptyGroupingEtas() },
    ]);
    expect(ok.fields.vessel).toBe('ALPHA');
    expect(ok.reason).toBeUndefined();

    const conflict = mergeClusterVoyageFields([
      { vessel: 'ALPHA', etas: emptyGroupingEtas() },
      { vessel: 'BETA', etas: emptyGroupingEtas() },
    ]);
    expect(conflict.reason).toMatch(/differ/i);
  });
});
