import { describe, expect, it } from 'vitest';
import {
  OIL_LOSS_SNAPSHOT_LOGIC_VERSION,
  canonicalizeOilLossVesselName,
  oilLossSnapshotNeedsRebuild,
} from './oilLossSnapshot.service';

describe('canonicalizeOilLossVesselName: a vessel without a Master Vessel is drawn as the Shipments list draws it', () => {
  const vessel = (name: string, extra: Record<string, unknown> = {}) => ({
    transport_mode: 'SEA',
    vessel_name: name,
    transporter: name,
    ...extra,
  });

  it('cuts a SAP tug / barge pair to the cargo-carrying barge, in upper case', () => {
    expect(canonicalizeOilLossVesselName(vessel('TB. ELIZABETH / BG. ASL 78'))).toMatchObject({ vessel_name: 'BG. ASL 78', transporter: 'BG. ASL 78' });
    expect(canonicalizeOilLossVesselName(vessel('TB.SHIENNY/BG.RHONDA'))).toMatchObject({ vessel_name: 'BG.RHONDA', transporter: 'BG.RHONDA' });
    expect(canonicalizeOilLossVesselName(vessel('TK. SHERIN 03/TB. PACIFIC STAR I'))).toMatchObject({ vessel_name: 'TK. SHERIN 03' });
  });

  it('upper-cases a plain name and keeps one that is already canonical as the same row', () => {
    expect(canonicalizeOilLossVesselName(vessel('Mel 02'))).toMatchObject({ vessel_name: 'MEL 02', transporter: 'MEL 02' });
    const done = vessel('BG. MEL 02');
    expect(canonicalizeOilLossVesselName(done)).toBe(done);
  });

  it('leaves a trucking row, a blank name and a row that is not SEA alone', () => {
    const company = vessel('', { transporter: 'PT. MARGA DINAMIK PERKASA' });
    expect(canonicalizeOilLossVesselName(company)).toBe(company);
    const land = { transport_mode: 'LAND', vessel_name: 'tb. x / bg. y', transporter: 'PT. ABC' };
    expect(canonicalizeOilLossVesselName(land)).toBe(land);
  });

  it('does not overwrite a transporter that is not the vessel', () => {
    expect(canonicalizeOilLossVesselName(vessel('TB. A / BG. B', { transporter: 'PT. SOMEONE' }))).toMatchObject({
      vessel_name: 'BG. B',
      transporter: 'PT. SOMEONE',
    });
  });
});

describe('oilLossSnapshotNeedsRebuild', () => {
  const built = {
    refreshedAt: new Date('2026-09-23T00:00:00Z'),
    isStale: false,
    logicVersion: OIL_LOSS_SNAPSHOT_LOGIC_VERSION,
    totalGainKg: 0,
    gainCount: 0,
  };

  it('rebuilds when the snapshot has never been written', () => {
    expect(oilLossSnapshotNeedsRebuild(null)).toBe(true);
    expect(oilLossSnapshotNeedsRebuild({ ...built, refreshedAt: null })).toBe(true);
  });

  it('rebuilds when stale or built by another logic version', () => {
    expect(oilLossSnapshotNeedsRebuild({ ...built, isStale: true })).toBe(true);
    expect(oilLossSnapshotNeedsRebuild({ ...built, logicVersion: 0 })).toBe(true);
  });

  it('keeps a fresh snapshot at the current logic version', () => {
    expect(oilLossSnapshotNeedsRebuild(built)).toBe(false);
  });

  it('rebuilds a snapshot that filled a blank SFAL from a sibling PO', () => {
    expect(OIL_LOSS_SNAPSHOT_LOGIC_VERSION).toBeGreaterThanOrEqual(9);
    expect(oilLossSnapshotNeedsRebuild({ ...built, logicVersion: 8 })).toBe(true);
  });

  it('rebuilds a snapshot written before a B2B origin took its ending child\'s discharge port', () => {
    expect(OIL_LOSS_SNAPSHOT_LOGIC_VERSION).toBeGreaterThanOrEqual(10);
    expect(oilLossSnapshotNeedsRebuild({ ...built, logicVersion: 9 })).toBe(true);
  });
});
