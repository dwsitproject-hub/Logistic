/**
 * Submit to Jetty: the shapes the backend answers with (backend/src/jps/readiness.ts, manualSubmit.ts, submit.ts) and the words the dialog shows for them.
 * Kept free of React so the wording can be tested.
 */

export type JettyFixAt = 'shipment' | 'master_port' | 'master_vessel' | 'master_product' | 'master_company' | 'sap' | 'jps' | 'settings'

export interface JettyCheck {
  key: string
  label: string
  ok: boolean
  value: string
  fix?: string
  fixAt?: JettyFixAt
}

export interface JettyTracker {
  state: string
  revision: number
  jpsStatus: string | null
  lastError: string | null
  updatedAt: string | null
  rejectionReason?: string | null
  rejectedAt?: string | null
}

/** Present when JPS closed the instruction KLIP sent (rejected, or deleted by an operator): sending again creates a NEW instruction under the next revision. */
export interface JettyResubmit {
  /** What JPS says the closed instruction is: 'Rejected' or 'Deleted'. */
  status?: string
  fromRevision: number
  rejectionReason: string | null
  rejectedAt: string | null
  /** True when what KLIP would send now is identical to what JPS rejected; null when that could not be worked out. */
  payloadUnchanged: boolean | null
}

export interface JettyReadiness {
  stoKey: string | null
  canSubmit: boolean
  reason: string | null
  tracker: JettyTracker | null
  resubmit?: JettyResubmit | null
  checks: JettyCheck[]
}

/** What "Refresh from JPS" answered (backend/src/jps/poll.ts refreshInstructionFromJps). */
export type JettyRefreshOutcome =
  | { kind: 'refreshed'; status: string | null; previousStatus: string | null; changed: boolean }
  | { kind: 'too_soon'; retryInSeconds: number; status: string | null }
  | { kind: 'none' }
  | { kind: 'failed'; message: string }

export interface JettyRefreshResult {
  refresh: JettyRefreshOutcome
  readiness: JettyReadiness
}

/**
 * Whether the screen is behind KLIP's own record after "Refresh from JPS", so the Jetty Status badge and the list behind the modal must be read again.
 *
 * The `status` a "too soon" answer carries is not a fresh answer from JPS: it is the status KLIP already HOLDS (the sweep or the JPS webhook wrote it a moment
 * ago, which is exactly why JPS is not asked again). A modal opened BEFORE that write still shows the old one, so JPS: Approved sat in the banner beside a Pending
 * badge, and only a refresh that found a CHANGE re-read the badge. The test is therefore "does what KLIP holds differ from what is shown", whatever the answer was.
 */
export function jettyRefreshNeedsReload(refresh: JettyRefreshOutcome, shownStatus: string | null | undefined): boolean {
  if (refresh.kind === 'refreshed' && refresh.changed) return true
  if (refresh.kind !== 'refreshed' && refresh.kind !== 'too_soon') return false
  const held = String(refresh.status ?? '').trim().toLowerCase()
  return held !== '' && held !== String(shownStatus ?? '').trim().toLowerCase()
}

export interface JettyInstruction {
  id?: number
  status?: string
  external_reference?: string
}

export type JettyOutcome =
  | { kind: 'submitted'; revision: number; instruction: JettyInstruction }
  | { kind: 'recovered'; revision: number; instruction: JettyInstruction }
  | { kind: 'held'; revision: number; problems: string[] }
  | { kind: 'failed'; revision: number; message: string; code?: string; details: string[]; requestId?: string }
  | { kind: 'retryable'; message: string; code?: string; status?: number; requestId?: string }

export interface JettySubmitResult {
  attempted: boolean
  readiness: JettyReadiness
  outcome: JettyOutcome | null
}

/** Where each kind of fix is done: the KLIP page that owns it, or null when it is done on this shipment / outside KLIP. */
export const JETTY_FIX_PAGE: Partial<Record<JettyFixAt, { label: string; href: string }>> = {
  master_port: { label: 'Master Port', href: '/master-loading-port' },
  master_vessel: { label: 'Master Vessel', href: '/master-vessel' },
  master_product: { label: 'Master Product', href: '/master-product-configuration' },
  master_company: { label: 'Master Company (Internal)', href: '/master-company' },
}

export type JettyTone = 'success' | 'error' | 'warning' | 'info'

export interface JettyOutcomeView {
  tone: JettyTone
  title: string
  lines: string[]
}

/** What to tell the user about a submission, in plain words, with JPS's own answer included verbatim. */
export function describeJettyResult(result: JettySubmitResult): JettyOutcomeView {
  const o = result.outcome
  if (!result.attempted || !o) {
    return {
      tone: 'warning',
      title: 'Not sent',
      lines: [result.readiness.reason ?? 'Some requirements are not met yet.'],
    }
  }
  switch (o.kind) {
    case 'submitted':
    case 'recovered':
      return {
        tone: 'success',
        title: 'JPS accepted the instruction',
        lines: [
          `Status at JPS: ${o.instruction.status ?? 'Pending'}. An operator decides next; the Jetty Status of this STO now follows JPS.`,
          ...(o.instruction.external_reference ? [`Reference: ${o.instruction.external_reference}`] : []),
          ...(o.kind === 'recovered' ? ['JPS already held this reference (an earlier attempt reached it); it was linked, not sent twice.'] : []),
        ],
      }
    case 'failed':
      return {
        tone: 'error',
        title: 'JPS did not accept the instruction',
        lines: [
          `JPS answered: ${o.code ? `${o.code}: ` : ''}${o.message}`,
          ...o.details.map((d) => `• ${d}`),
          ...(o.requestId ? [`JPS request id: ${o.requestId} (give this to the JPS team)`] : []),
          'Nothing was created at JPS. KLIP keeps this as Send Failed and does not resend it on its own; fix the cause, then press Submit to Jetty again.',
        ],
      }
    case 'held':
      return {
        tone: 'warning',
        title: 'Held by KLIP before sending',
        lines: [...o.problems.map((p) => `• ${p}`), 'Nothing was sent to JPS.'],
      }
    case 'retryable':
      return {
        tone: 'info',
        title: 'JPS did not answer properly',
        lines: [
          `${o.status ? `HTTP ${o.status} ` : ''}${o.code ? `${o.code}: ` : ''}${o.message}`,
          ...(o.requestId ? [`JPS request id: ${o.requestId}`] : []),
          'Nothing was recorded. KLIP tries again by itself within about 15 minutes, or press Submit to Jetty again in a few minutes.',
        ],
      }
  }
}

/** The requirements that are not met, in the order they should be fixed. */
export function unmetChecks(readiness: JettyReadiness | null | undefined): JettyCheck[] {
  return (readiness?.checks ?? []).filter((c) => !c.ok)
}

/** One line saying what JPS answered to "Refresh from JPS". */
export function describeJettyRefresh(refresh: JettyRefreshOutcome): { tone: JettyTone; text: string } {
  switch (refresh.kind) {
    case 'refreshed':
      return refresh.changed
        ? { tone: refresh.status === 'Rejected' || refresh.status === 'Deleted' ? 'warning' : 'success', text: `JPS now reports this instruction as ${refresh.status ?? 'unknown'} (it was ${refresh.previousStatus ?? 'unknown'} in KLIP).` }
        : { tone: 'info', text: `JPS still reports ${refresh.status ?? 'no status'}; nothing changed.` }
    case 'too_soon': {
      const minutes = Math.ceil(refresh.retryInSeconds / 60)
      return { tone: 'info', text: `JPS asks for at most one check per instruction every few minutes. KLIP last asked a moment ago (JPS: ${refresh.status ?? 'no status'}); try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.` }
    }
    case 'none':
      return { tone: 'info', text: 'KLIP has no instruction at JPS for this STO to ask about.' }
    case 'failed':
      return { tone: 'error', text: `JPS did not answer: ${refresh.message}` }
  }
}

/** The explanation shown above the requirements when JPS rejected the instruction: why, what sending again does, and a warning if nothing was fixed. */
export function describeJettyResubmit(resubmit: JettyResubmit): { title: string; lines: string[]; warning: string | null } {
  const when = resubmit.rejectedAt ? ` on ${resubmit.rejectedAt.slice(0, 10)}` : ''
  const deleted = resubmit.status === 'Deleted'
  return {
    title: deleted ? `A JPS operator deleted this instruction${when}` : `JPS rejected this instruction${when}`,
    lines: [
      resubmit.rejectionReason
        ? `Reason from JPS: ${resubmit.rejectionReason}`
        : deleted
          ? 'JPS gives no reason for a deleted instruction. If it was deleted by mistake or the plan changed, send it again.'
          : 'JPS gave no reason. Ask the JPS operator, or fix what looks wrong and send again.',
      `Sending again creates a NEW instruction (revision ${resubmit.fromRevision + 1}) with a new reference. The rejected one stays at JPS as history.`,
    ],
    warning:
      resubmit.payloadUnchanged === true
        ? 'What KLIP would send now is the same as what JPS rejected. If the cause was data in KLIP, fix it first; if it was on the JPS side (their master data, berth), you can send once that is fixed.'
        : null,
  }
}
