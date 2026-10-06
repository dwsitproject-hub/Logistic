import { describe, expect, it } from 'vitest';
import { emptyGroupingEtas } from './shipmentGroupingEtaColumns';
import {
  charterTypeFromMasterTerms,
  classifyGroupingClusterMode,
  mergeClusterVoyageFields,
  mergeClusterVoyageFieldsByPort,
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

describe('mergeClusterVoyageFieldsByPort - one voyage loading at two ports', () => {
  const etas = (over: Record<string, string>) => ({ ...emptyGroupingEtas(), ...over }) as ReturnType<typeof emptyGroupingEtas>;
  const dp = { eta_discharge_arrival: '2026-10-20', eta_discharge_complete: '2026-10-24' };

  it('POs at different loading ports may carry different loading ETAs; both get the voyage discharge ETAs', () => {
    const merged = mergeClusterVoyageFieldsByPort([
      { vessel: 'AS MARINA 10', portKey: 'PORT A', etas: etas({ eta_arrival: '2026-10-05', eta_sailed: '2026-10-08', ...dp }) },
      { vessel: 'AS MARINA 10', portKey: 'PORT B', etas: etas({ eta_arrival: '2026-10-09', eta_sailed: '2026-10-12', ...dp }) },
    ]);
    expect(merged.reason).toBeUndefined();
    expect(merged.etasByPort.get('PORT A')).toMatchObject({ eta_arrival: '2026-10-05', eta_sailed: '2026-10-08', ...dp });
    expect(merged.etasByPort.get('PORT B')).toMatchObject({ eta_arrival: '2026-10-09', eta_sailed: '2026-10-12', ...dp });
  });

  it('two POs at the SAME port that disagree are still refused - that is a typo, not a second call', () => {
    const merged = mergeClusterVoyageFieldsByPort([
      { portKey: 'PORT A', etas: etas({ eta_arrival: '2026-10-05' }) },
      { portKey: 'PORT A', etas: etas({ eta_arrival: '2026-10-06' }) },
    ]);
    expect(merged.reason).toMatch(/same loading port.*eta_arrival.*PORT A/);
  });

  it('the discharge ETAs are one per voyage: a different value on another row is refused', () => {
    const merged = mergeClusterVoyageFieldsByPort([
      { portKey: 'PORT A', etas: etas({ eta_discharge_arrival: '2026-10-20' }) },
      { portKey: 'PORT B', etas: etas({ eta_discharge_arrival: '2026-10-21' }) },
    ]);
    expect(merged.reason).toBe('ETA values differ in the same Group (eta_discharge_arrival)');
  });

  it('a port that leaves a loading ETA blank takes the Group first value, exactly as a blank always did', () => {
    const merged = mergeClusterVoyageFieldsByPort([
      { portKey: 'PORT A', etas: etas({ eta_arrival: '2026-10-05', ...dp }) },
      { portKey: 'PORT B', etas: etas({}) },
    ]);
    expect(merged.reason).toBeUndefined();
    expect(merged.etasByPort.get('PORT B')).toMatchObject({ eta_arrival: '2026-10-05', ...dp });
  });

  it('a port with its own value keeps it even when another port filled the same column first', () => {
    const merged = mergeClusterVoyageFieldsByPort([
      { portKey: 'PORT A', etas: etas({ eta_arrival: '2026-10-05' }) },
      { portKey: 'PORT B', etas: etas({ eta_arrival: '2026-10-09' }) },
      { portKey: 'PORT B', etas: etas({}) },
    ]);
    expect(merged.etasByPort.get('PORT B')?.eta_arrival).toBe('2026-10-09');
    expect(merged.etasByPort.get('PORT A')?.eta_arrival).toBe('2026-10-05');
  });

  it('a Group at one port behaves exactly like the old whole-Group merge', () => {
    const rows = [
      { vessel: 'V1', etas: etas({ eta_arrival: '2026-10-05', ...dp }) },
      { vessel: 'v1', etas: etas({}) },
    ];
    const old = mergeClusterVoyageFields(rows);
    const next = mergeClusterVoyageFieldsByPort(rows.map((r) => ({ ...r, portKey: 'PORT A' })));
    expect(next.reason).toBe(old.reason);
    expect(next.fields).toEqual(old.fields);
    expect(next.etasByPort.get('PORT A')).toEqual(old.fields.etas);
  });

  it('refuses two different vessels in one Group, as before', () => {
    expect(
      mergeClusterVoyageFieldsByPort([
        { vessel: 'V1', portKey: 'A', etas: etas({}) },
        { vessel: 'V2', portKey: 'B', etas: etas({}) },
      ]).reason,
    ).toMatch(/Vessel values differ/);
  });
});
