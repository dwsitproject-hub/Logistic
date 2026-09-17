import { hasKlipSapMismatch, hasKlipSapValue, type KlipSapCompareFormat } from '@/lib/klipSapCompare'
import { isKlipEditedField } from '@/lib/klipProvenance'

/**
 * A one-line answer to "does this shipment need checking?", computed before the user scrolls.
 *
 * The modal shows the ATA and Quality comparisons across seven collapsible blocks, so a value that
 * disagrees with SAP can sit three scrolls down. Counting them up front turns the question from a
 * reading exercise into a glance.
 *
 * Counts fields, not rows: one port with two differing ATAs is two.
 */
export type KlipSapProvenanceSummary = {
  /** Has a value that differs from what SAP reported. */
  differing: number
  /** Of those, the ones the data records a KLIP user writing. */
  klipRecorded: number
  /** Of those, the ones with no recorded author - older rows, provenance unknown. */
  unrecorded: number
}

/** Effective column paired with its SAP snapshot, per `vessel_loading_ports`. */
const PORT_COMPARED_FIELDS: Array<{ column: string; sapColumn: string; format: KlipSapCompareFormat }> = [
  { column: 'ata_vessel_arrival', sapColumn: 'sap_ata_vessel_arrival', format: 'date' },
  { column: 'ata_vessel_berthed', sapColumn: 'sap_ata_vessel_berthed', format: 'date' },
  { column: 'ata_loading_start', sapColumn: 'sap_ata_loading_start', format: 'date' },
  { column: 'ata_loading_completed', sapColumn: 'sap_ata_loading_completed', format: 'date' },
  { column: 'ata_vessel_sailed', sapColumn: 'sap_ata_vessel_sailed', format: 'date' },
  { column: 'quality_ffa', sapColumn: 'sap_quality_ffa', format: 'number' },
  { column: 'quality_mi', sapColumn: 'sap_quality_mi', format: 'number' },
  { column: 'quality_dobi', sapColumn: 'sap_quality_dobi', format: 'number' },
  { column: 'quality_red', sapColumn: 'sap_quality_red', format: 'number' },
  { column: 'quality_ds', sapColumn: 'sap_quality_ds', format: 'number' },
  { column: 'quality_stone', sapColumn: 'sap_quality_stone', format: 'number' },
]

export function summarizePortProvenance(
  ports: ReadonlyArray<Record<string, unknown>> | undefined | null,
): KlipSapProvenanceSummary {
  const summary: KlipSapProvenanceSummary = { differing: 0, klipRecorded: 0, unrecorded: 0 }
  if (!Array.isArray(ports)) return summary

  for (const port of ports) {
    if (!port) continue
    const edited = port.klip_edited_fields
    for (const { column, sapColumn, format } of PORT_COMPARED_FIELDS) {
      const value = port[column]
      if (!hasKlipSapValue(value, format)) continue
      /*
       * Only fields that disagree with SAP are counted. A value matching SAP is not something a
       * reviewer needs to look at, whoever typed it - and counting it would bury the handful that
       * do differ under a hundred that do not.
       */
      if (!hasKlipSapMismatch(value, port[sapColumn], format)) continue
      summary.differing++
      if (isKlipEditedField(edited, column)) summary.klipRecorded++
      else summary.unrecorded++
    }
  }
  return summary
}

/** Indonesian one-liner for the modal header. Null when there is nothing worth saying. */
export function describePortProvenance(summary: KlipSapProvenanceSummary): string | null {
  if (summary.differing === 0) return null
  const parts = [`${summary.differing} field berbeda dari SAP`]
  if (summary.klipRecorded > 0) parts.push(`${summary.klipRecorded} diubah lewat KLIP`)
  return parts.join(' · ')
}
