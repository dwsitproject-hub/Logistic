import type { ShipmentAtaApiField } from '@/lib/shipmentAtaFields'
import type { ReactNode } from 'react'

/**
 * Jetty Planning System status, shared by the Shipments table and the Edit/View Shipment modal so
 * the two cannot drift apart.
 *
 * The values are JPS's own partner statuses, passed through untranslated: Pending (waiting for an
 * operator), Approved (accepted, no berth yet), Allocated (berth assigned), Sailed (vessel departed
 * - terminal, added in JPS v5.0), Rejected (declined, with a reason), Deleted (removed by a JPS operator; undocumented in the guide up to v5.6). Anything else means KLIP has
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
  | 'Deleted'
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
   * Why jetty_status is empty, when KLIP did try: 'FAILED' (JPS refused the submission) or 'HELD' (KLIP has not sent it yet, e.g. a product without a JPS
   * cargo code). Empty means KLIP never tried (the STO is not eligible yet) - the only case that reads "Not Sent".
   */
  jetty_send_state?: 'FAILED' | 'HELD' | string | null
  /** What JPS answered (FAILED) or what is missing (HELD). */
  jetty_send_error?: string | null
  /** When that row was last written. */
  jetty_send_at?: string | null
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
  // JPS v5.7 stages after Allocated, shown as JPS gives them: berthed, hoses on, cargo and final checks done.
  Berthed: 'bg-emerald-100 text-emerald-800',
  'Start Cargo': 'bg-cyan-100 text-cyan-800',
  'Cargo Done': 'bg-teal-100 text-teal-800',
  // Discharge finished, vessel not sailed yet: a stage of its own, so it must not read like Allocated. Only for a JPS that does not yet report v5.7's own stages
  // (see jettyStatusSql.ts); on v5.7 the status is shown as JPS gives it.
  'Completed (Hose Off)': 'bg-teal-100 text-teal-800',
  // Terminal and uneventful: the voyage is done, so it reads quieter than Allocated. `Sailed` is the name before v5.7 (a row stored then keeps it).
  'Sailed Off': 'bg-slate-100 text-slate-700',
  Sailed: 'bg-slate-100 text-slate-700',
  Rejected: 'bg-red-100 text-red-800',
  // An operator deleted the instruction at JPS (not in the partner guide): closed like Rejected, but nobody refused it, so it reads quieter.
  Deleted: 'bg-gray-200 text-gray-700',
}

const NOT_SENT_CLASS = 'bg-gray-100 text-gray-600'

/** KLIP tried and JPS refused: not the same as Rejected, which is a decision JPS made on an instruction it accepted. */
export const JETTY_SEND_FAILED = 'Send Failed'
/** KLIP is holding it back (missing cargo code, odd quantity) and will send once the data is fixed. */
export const JETTY_ON_HOLD = 'On Hold'

const SEND_STATE_CLASS: Record<string, string> = {
  [JETTY_SEND_FAILED]: 'bg-orange-100 text-orange-800',
  [JETTY_ON_HOLD]: 'bg-violet-100 text-violet-800',
}

/**
 * What the badge says. JPS's own status wins; with none, "Send Failed" / "On Hold" say that KLIP DID try, and "Not Sent" is left for the STO KLIP has
 * not tried (not eligible yet, or not for JPS at all). Before this, all three read "Not Sent".
 */
export function jettyStatusLabel(row: JettyStatusFields | null | undefined): string {
  const status = String(row?.jetty_status ?? '').trim()
  if (status) return status
  const sendState = String(row?.jetty_send_state ?? '').trim().toUpperCase()
  if (sendState === 'FAILED') return JETTY_SEND_FAILED
  if (sendState === 'HELD') return JETTY_ON_HOLD
  return 'Not Sent'
}

/**
 * What a badge or a sentence SAYS for a status: the stage JPS gave, with what it means on the berth where JPS's own name does not say it. Start Cargo is the hoses
 * going on, Cargo Done the hoses coming off (and the final checks). Every other status reads as it is. jettyStatusLabel stays the value to compare, sort and colour by:
 * this is display only.
 */
const JETTY_STAGE_MEANING: Record<string, string> = {
  'Start Cargo': 'Start Cargo (Hose On)',
  'Cargo Done': 'Cargo Done (Hose Off)',
}

export function jettyStatusText(row: JettyStatusFields | null | undefined): string {
  const label = jettyStatusLabel(row)
  return JETTY_STAGE_MEANING[label] ?? label
}

/** What the Submit to Jetty button does for the status JPS holds: send (nothing at JPS), resubmit (JPS closed it), or locked (JPS holds a live instruction). */
export type JettySubmitMode = 'submit' | 'resubmit' | 'locked'

/**
 * The button follows what JPS says about the instruction KLIP sent:
 * - Rejected or Deleted: JPS closed it; sending again creates a NEW instruction (next revision), so the wording is "Resubmit to Jetty".
 * - Any other status JPS holds (Pending, Approved, Allocated, Berthed, Start Cargo, Cargo Done, Sailed Off, and the older Sailed): JPS has no way to replace it, so the button
 *   is disabled. From JPS v5.7 "Hose On" is the stage `Start Cargo`; before it, it was only the ATS time while the instruction stayed Allocated. An unknown future status
 *   locks too, which is the safe side: the backend refuses it as well.
 * - Nothing at JPS (Not Sent, Send Failed, On Hold): the normal Submit to Jetty.
 */
export function jettySubmitMode(row: JettyStatusFields | null | undefined): JettySubmitMode {
  const status = String(row?.jetty_status ?? '').trim()
  if (!status) return 'submit'
  return status === 'Rejected' || status === 'Deleted' ? 'resubmit' : 'locked'
}

/**
 * Whether asking JPS for the status now can tell us something: the statuses KLIP's own poller keeps polling (an instruction that can still move; backend/src/jps/types.ts
 * JPS_LIVE_STATUSES, plus the derived "Completed (Hose Off)"). A Sailed Off (or older Sailed), Rejected or Deleted instruction is final and is not asked about again.
 */
export function jettyCanRefresh(row: JettyStatusFields | null | undefined): boolean {
  const status = String(row?.jetty_status ?? '').trim()
  return ['Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done', 'Completed (Hose Off)'].includes(status)
}

/**
 * The extra context a user needs on hover: which berth, when it is planned, or why it was turned
 * down. JPS gives no way to cancel or amend an instruction after approval, so a rejection reason is
 * the only thing that explains what to do next.
 */
export function jettyStatusTooltip(row: JettyStatusFields | null | undefined): string | undefined {
  if (!row?.jetty_status) return jettySendStateTooltip(row)
  const parts: string[] = []
  if (row.jetty_name) parts.push(`Jetty: ${row.jetty_name}`)
  if (row.jetty_planned_berthing_time) {
    parts.push(`Planned berthing: ${formatJettyDate(row.jetty_planned_berthing_time)}`)
  }
  if (row.jetty_hose_off_at) parts.push(`Hose Off: ${formatJettyDate(row.jetty_hose_off_at)}`)
  if (row.jetty_rejection_reason) parts.push(`Reason: ${row.jetty_rejection_reason}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** The hover text of "Send Failed" / "On Hold": what happened and what to do. Nothing for "Not Sent". */
export function jettySendStateTooltip(row: JettyStatusFields | null | undefined): string | undefined {
  const label = jettyStatusLabel(row)
  if (label !== JETTY_SEND_FAILED && label !== JETTY_ON_HOLD) return undefined
  const error = String(row?.jetty_send_error ?? '').trim()
  const lines =
    label === JETTY_SEND_FAILED
      ? [
          'KLIP sent this STO to JPS and JPS did not accept it.',
          error ? `JPS answered: ${error}` : null,
          'KLIP does not resend a refused STO unless retry is switched on. Fix the cause (often JPS master data), then ask an administrator to resend.',
        ]
      : [
          'KLIP is holding this STO back and has not sent it to JPS yet.',
          error ? `Reason: ${error}` : null,
          'Once the data is fixed it can be sent: press Submit to Jetty on the shipment (or, when Send automatically is on in Integrations > JPS, it is sent on its own).',
        ]
  if (row?.jetty_send_at) lines.push(`Last attempt: ${new Date(row.jetty_send_at).toLocaleString('en-GB')}`)
  return lines.filter(Boolean).join('\n')
}

export function JettyStatusBadge({
  row,
  className = '',
}: {
  row: JettyStatusFields | null | undefined
  className?: string
}): ReactNode {
  const label = jettyStatusLabel(row)
  const tone = BADGE_CLASS[label] ?? SEND_STATE_CLASS[label] ?? NOT_SENT_CLASS
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone} ${className}`}
      title={jettyStatusTooltip(row)}
    >
      {jettyStatusText(row)}
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
