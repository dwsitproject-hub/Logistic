/** Idle gap in ms — user considered inactive after this gap between events. */
export const USER_ACTIVITY_IDLE_GAP_MS = 10 * 60 * 1000;

/** Cap credited time after the last event in a session. */
const TAIL_ACTIVITY_MS = 60 * 1000;

/**
 * Sum active time from ordered event timestamps.
 * Each gap between events counts up to USER_ACTIVITY_IDLE_GAP_MS.
 */
export function computeActiveSecondsFromTimestamps(timestamps: Date[]): number {
  if (timestamps.length === 0) return 0;
  if (timestamps.length === 1) return Math.round(TAIL_ACTIVITY_MS / 1000);

  let totalMs = 0;
  for (let i = 0; i < timestamps.length - 1; i++) {
    const gap = timestamps[i + 1].getTime() - timestamps[i].getTime();
    if (gap <= 0) continue;
    totalMs += Math.min(gap, USER_ACTIVITY_IDLE_GAP_MS);
  }
  totalMs += Math.min(TAIL_ACTIVITY_MS, USER_ACTIVITY_IDLE_GAP_MS);
  return Math.round(totalMs / 1000);
}

export function formatActiveDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
