/** The On Time / Late split on a Contract Performance status card. */
export interface OnTimeLateSplit {
  /** "56%" or "N/A" when there is no contract in the card. */
  onTimeLabel: string
  lateLabel: string
  /** Bar widths in percent of the bar (0 when there is nothing to show). */
  onTimeWidth: number
  lateWidth: number
}

export function onTimeLateSplit(onTimeCount: number, lateCount: number): OnTimeLateSplit {
  const onTime = Math.max(0, Number(onTimeCount) || 0)
  const late = Math.max(0, Number(lateCount) || 0)
  const total = onTime + late
  if (total <= 0) return { onTimeLabel: 'N/A', lateLabel: 'N/A', onTimeWidth: 0, lateWidth: 0 }
  return {
    onTimeLabel: `${Math.round((onTime / total) * 100)}%`,
    lateLabel: `${Math.round((late / total) * 100)}%`,
    onTimeWidth: (onTime / total) * 100,
    lateWidth: (late / total) * 100,
  }
}
