import { describe, expect, it } from 'vitest';
import { OIL_LOSS_SNAPSHOT_LOGIC_VERSION, oilLossSnapshotNeedsRebuild } from './oilLossSnapshot.service';

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

  it('rebuilds a snapshot built before vessel qty matched View Shipment', () => {
    expect(OIL_LOSS_SNAPSHOT_LOGIC_VERSION).toBe(6);
    expect(oilLossSnapshotNeedsRebuild({ ...built, logicVersion: 5 })).toBe(true);
  });
});
