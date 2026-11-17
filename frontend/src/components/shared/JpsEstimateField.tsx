'use client'

import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { KlipSapSourceBadge } from '@/components/shared/KlipSapCompareField'
import { ModalReadonlyDateInput } from '@/components/shared/ModalReadonlyControl'
import { formatKlipSapDisplayValue } from '@/lib/klipSapCompare'
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
 * date moves after KLIP sent its own ETA; KLIP's own estimate stays underneath, small, and stays editable where the page allows editing. A field JPS has nothing for
 * never uses this: it keeps its normal control.
 */
export function JpsEstimateField({
  label,
  jpsIso,
  klipIso,
  canEdit,
  onChangeKlip,
}: {
  label: string
  jpsIso: string
  klipIso: string
  canEdit: boolean
  onChangeKlip?: (iso: string) => void
}) {
  const klip = String(klipIso ?? '').trim().slice(0, 10)
  const differs = Boolean(klip) && klip !== jpsIso
  return (
    <div>
      <label className="mb-1 block text-[0.625rem] font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ModalReadonlyDateInput valueIso={jpsIso} compact />
        </div>
        <KlipSapSourceBadge provenance="jps" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.625rem] text-gray-500">
        <KlipSapSourceBadge provenance="klip" />
        {canEdit && onChangeKlip ? (
          <DateInputDdMmYyyy valueIso={klip} onChangeIso={onChangeKlip} className="h-6 w-28 text-[0.6875rem]" />
        ) : (
          <span className={differs ? 'font-medium text-amber-800' : undefined}>{klip ? formatKlipSapDisplayValue(klip, 'date') : '-'}</span>
        )}
        {differs ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">beda dari JPS</span> : null}
      </div>
    </div>
  )
}
