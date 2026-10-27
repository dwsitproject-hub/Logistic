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
}

export interface JettyReadiness {
  stoKey: string | null
  canSubmit: boolean
  reason: string | null
  tracker: JettyTracker | null
  checks: JettyCheck[]
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
