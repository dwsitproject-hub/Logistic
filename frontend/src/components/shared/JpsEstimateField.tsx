'use client'

import { KlipSapSourceBadge } from '@/components/shared/KlipSapCompareField'
import { ModalReadonlyDateInput } from '@/components/shared/ModalReadonlyControl'
import { formatDateDelta, formatKlipSapDisplayValue } from '@/lib/klipSapCompare'
import type { ShipmentEstimateApiField } from '@/lib/jettyStatus'

/** The modal's own names for the three discharge estimates JPS also reports, and the name JPS's value travels under (backend/src/jps/scheduleAtaSql.ts sqlJpsEstimateJsonExpr). */
export const JPS_ESTIMATE_FIELD_BY_MODAL_KEY: Readonly<Record<string, ShipmentEstimateApiField>> = {
  etaVesselArriveAtDischargePort: 'eta_vessel_arrive_at_discharge_port',
  etaVesselBerthedAtDischargePort: 'eta_vessel_berthed_at_discharge_port',
  etaVesselCompleteDischarge: 'eta_vessel_complete_discharge',
}

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/

/** The JPS estimate (YYYY-MM-DD, WIB) for one of the modal's estimation keys, or '' when JPS has none or the field is not one JPS estimates. */
export function jpsEstimateIso(
  jpsEst: Partial<Record<ShipmentEstimateApiField, string | null>> | null | undefined,
  modalKey: string,
): string {
  const field = JPS_ESTIMATE_FIELD_BY_MODAL_KEY[modalKey]
  const value = field ? String(jpsEst?.[field] ?? '').trim() : ''
  return ISO_DAY.test(value) ? value.slice(0, 10) : ''
}

/**
 * An estimation field that JPS has a value for: the JPS date is the main value (read-only, with the violet JPS badge), because the JPS operators plan the berth and the
 * date moves after KLIP sent its own ETA. KLIP's own estimate stays underneath, small and READ-ONLY: once JPS has overridden the date, the plan is JPS's to change, so
 * editing the KLIP copy would only create a second, hidden schedule. When the two differ the gap in days (+1d / -1d, KLIP minus the main JPS value) shows in amber next to it; the
 * tooltip has both dates. A field JPS has nothing for never uses this: it keeps its normal, editable control.
 */
export function JpsEstimateField({ label, jpsIso, klipIso }: { label: string; jpsIso: string; klipIso: string }) {
  const klip = String(klipIso ?? '').trim().slice(0, 10)
  const differs = Boolean(klip) && klip !== jpsIso
  const delta = differs ? formatDateDelta(klip, jpsIso) : null
  const hint = differs ? `KLIP ${formatKlipSapDisplayValue(klip, 'date')} · JPS ${formatKlipSapDisplayValue(jpsIso, 'date')}` : undefined
  return (
    <div>
      <label className="mb-1 block text-[0.625rem] font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ModalReadonlyDateInput valueIso={jpsIso} compact />
        </div>
        <KlipSapSourceBadge provenance="jps" />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[0.625rem] text-gray-500">
        <KlipSapSourceBadge provenance="klip" />
        <span className={differs ? 'text-amber-700' : undefined}>{klip ? formatKlipSapDisplayValue(klip, 'date') : '-'}</span>
        {delta ? (
          <span title={hint} className="font-semibold tabular-nums text-amber-700">
            {delta}
          </span>
        ) : null}
      </div>
    </div>
  )
}
