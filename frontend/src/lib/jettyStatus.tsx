import type { ShipmentAtaApiField } from '@/lib/shipmentAtaFields'
import type { ReactNode } from 'react'

/**
 * Jetty Planning System status, shared by the Shipments table and the Edit/View Shipment modal so
 * the two cannot drift apart.
 *
 * The values are JPS's own partner statuses, passed through untranslated: Pending (waiting for an
 * operator), Approved (accepted, no berth yet), Allocated (berth assigned), Sailed (vessel departed
 * - terminal, added in JPS v5.0), Rejected (declined, with a reason). Anything else means KLIP has
 * not submitted this STO.
 *
 * "Completed (Hose Off)" is the one value JPS does not send: JPS goes from Allocated straight to Sailed, and KLIP shows
 * the stretch in between - JPS has logged the end of the cargo operation (ATC Discharge) but the vessel has not sailed -
 * under this name. The backend derives it (utils/jettyStatusSql.ts); it is never stored.
 */
export type JettyStatusValue =
  | 'Pending'
  | 'Approved'
  | 'Allocated'
  | 'Completed (Hose Off)'
  | 'Rejected'
  | 'Sailed'
  | null
  | undefined

export interface JettyStatusFields {
  jetty_status?: string | null
  jetty_name?: string | null
  jetty_planned_berthing_time?: string | null
  jetty_rejection_reason?: string | null
  jetty_submitted_at?: string | null
  jetty_last_synced_at?: string | null
  /** When JPS logged the end of the cargo operation (Hose Off); the reason for "Completed (Hose Off)". */
  jetty_hose_off_at?: string | null
  /**
   * JPS actuals, keyed by the KLIP ATA field each corresponds to and already dated in WIB
   * (backend/src/jps/scheduleAtaSql.ts). Only the discharge fields JPS reports are present.
   */
  jps_ata?: Partial<Record<ShipmentAtaApiField, string | null>> | null
}

const BADGE_CLASS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-blue-100 text-blue-800',
  Allocated: 'bg-green-100 text-green-800',
  // Discharge finished, vessel not sailed yet: a stage of its own, so it must not read like Allocated.
  'Completed (Hose Off)': 'bg-teal-100 text-teal-800',
  // Terminal and uneventful: the voyage is done, so it reads quieter than Allocated.
  Sailed: 'bg-slate-100 text-slate-700',
  Rejected: 'bg-red-100 text-red-800',
}

const NOT_SENT_CLASS = 'bg-gray-100 text-gray-600'

export function jettyStatusLabel(row: JettyStatusFields | null | undefined): string {
  const status = String(row?.jetty_status ?? '').trim()
  return status || 'Not Sent'
}

/**
 * The extra context a user needs on hover: which berth, when it is planned, or why it was turned
 * down. JPS gives no way to cancel or amend an instruction after approval, so a rejection reason is
 * the only thing that explains what to do next.
 */
export function jettyStatusTooltip(row: JettyStatusFields | null | undefined): string | undefined {
  if (!row?.jetty_status) return undefined
  const parts: string[] = []
  if (row.jetty_name) parts.push(`Jetty: ${row.jetty_name}`)
  if (row.jetty_planned_berthing_time) {
    parts.push(`Planned berthing: ${formatJettyDate(row.jetty_planned_berthing_time)}`)
  }
  if (row.jetty_hose_off_at) parts.push(`Hose Off: ${formatJettyDate(row.jetty_hose_off_at)}`)
  if (row.jetty_rejection_reason) parts.push(`Reason: ${row.jetty_rejection_reason}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function JettyStatusBadge({
  row,
  className = '',
}: {
  row: JettyStatusFields | null | undefined
  className?: string
}): ReactNode {
  const label = jettyStatusLabel(row)
  const tone = BADGE_CLASS[label] ?? NOT_SENT_CLASS
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone} ${className}`}
      title={jettyStatusTooltip(row)}
    >
      {label}
    </span>
  )
}

function formatJettyDate(value: string | null | undefined): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * "Jetty Sync Dates": when KLIP sent the instruction and when it last heard back.
 *
 * Both matter and neither alone is enough. A submitted date with a stale sync date means the
 * poller has stopped; a fresh sync date on a Pending instruction means JPS simply has not decided
 * yet. JPS allows one poll per instruction per five minutes, so "last synced" is never live.
 */
export function formatJettySyncDates(row: JettyStatusFields | null | undefined): string {
  if (!row?.jetty_submitted_at && !row?.jetty_last_synced_at) return '-'
  return `${formatJettyDate(row?.jetty_submitted_at)} → ${formatJettyDate(row?.jetty_last_synced_at)}`
}

export function jettySyncDatesTooltip(row: JettyStatusFields | null | undefined): string | undefined {
  if (!row?.jetty_submitted_at && !row?.jetty_last_synced_at) return undefined
  const submitted = row?.jetty_submitted_at ? new Date(row.jetty_submitted_at).toLocaleString('en-GB') : '-'
  const synced = row?.jetty_last_synced_at ? new Date(row.jetty_last_synced_at).toLocaleString('en-GB') : 'never'
  return `Submitted to JPS: ${submitted}\nLast status check: ${synced}`
}
