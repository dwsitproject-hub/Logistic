import { describe, expect, it } from 'vitest'
import {
  JETTY_FIX_PAGE,
  describeJettyRefresh,
  describeJettyResubmit,
  describeJettyResult,
  unmetChecks,
  type JettyReadiness,
  type JettySubmitResult,
} from './jettySubmit'

const ready: JettyReadiness = {
  stoKey: '1006020269',
  canSubmit: true,
  reason: null,
  tracker: null,
  checks: [{ key: 'region', label: 'Region/Site is BONTANG', ok: true, value: 'BONTANG' }],
}

describe('describeJettyResult: what the user is told about a submission', () => {
  it('JPS accepted it: says so, with the status and the reference', () => {
    const v = describeJettyResult({
      attempted: true,
      readiness: ready,
      outcome: { kind: 'submitted', revision: 1, instruction: { id: 7, status: 'Pending', external_reference: 'KLIP-1006020269-R1' } },
    })
    expect(v.tone).toBe('success')
    expect(v.lines.join('\n')).toContain('Status at JPS: Pending')
    expect(v.lines.join('\n')).toContain('KLIP-1006020269-R1')
  })

  it('JPS refused it: shows JPS\'s message and every detail line verbatim, and that nothing was created', () => {
    const v = describeJettyResult({
      attempted: true,
      readiness: ready,
      outcome: {
        kind: 'failed',
        revision: 1,
        code: 'VALIDATION_ERROR',
        message: 'Payload validation failed',
        details: ['vessel_name: Master LOA must be a positive number'],
        requestId: 'req-9',
      },
    })
    expect(v.tone).toBe('error')
    const text = v.lines.join('\n')
    expect(text).toContain('VALIDATION_ERROR: Payload validation failed')
    expect(text).toContain('• vessel_name: Master LOA must be a positive number')
    expect(text).toContain('req-9')
    expect(text).toContain('Nothing was created at JPS')
  })

  it('a timeout / 5xx is not called a refusal: nothing recorded, KLIP retries', () => {
    const v = describeJettyResult({ attempted: true, readiness: ready, outcome: { kind: 'retryable', message: 'unavailable', status: 503, code: 'UPSTREAM' } })
    expect(v.tone).toBe('info')
    expect(v.lines.join('\n')).toContain('HTTP 503')
    expect(v.lines.join('\n')).toContain('Nothing was recorded')
  })

  it('held by KLIP: lists what is missing and says nothing was sent', () => {
    const v = describeJettyResult({
      attempted: true,
      readiness: ready,
      outcome: { kind: 'held', revision: 1, problems: ['no DHM code on Master Product for "POME"'] },
    })
    expect(v.tone).toBe('warning')
    expect(v.lines.join('\n')).toContain('• no DHM code on Master Product for "POME"')
    expect(v.lines.join('\n')).toContain('Nothing was sent to JPS')
  })

  it('not attempted: gives KLIP\'s reason instead of an error', () => {
    const r: JettySubmitResult = { attempted: false, readiness: { ...ready, canSubmit: false, reason: '2 requirements are not met.' }, outcome: null }
    const v = describeJettyResult(r)
    expect(v.tone).toBe('warning')
    expect(v.lines).toEqual(['2 requirements are not met.'])
  })
})

describe('unmetChecks and the pages that fix them', () => {
  it('returns only the requirements that are not met', () => {
    const r: JettyReadiness = {
      ...ready,
      canSubmit: false,
      checks: [
        { key: 'a', label: 'A', ok: true, value: '' },
        { key: 'b', label: 'B', ok: false, value: 'x', fixAt: 'master_vessel' },
      ],
    }
    expect(unmetChecks(r).map((c) => c.key)).toEqual(['b'])
    expect(unmetChecks(null)).toEqual([])
  })

  it('names a KLIP page for each master that an admin fills', () => {
    expect(JETTY_FIX_PAGE.master_port?.href).toBe('/master-loading-port')
    expect(JETTY_FIX_PAGE.master_vessel?.href).toBe('/master-vessel')
    expect(JETTY_FIX_PAGE.master_product?.href).toBe('/master-product-configuration')
    expect(JETTY_FIX_PAGE.master_company?.href).toBe('/master-company')
    // fixed on the shipment, in SAP or at JPS: no KLIP page to link
    expect(JETTY_FIX_PAGE.shipment).toBeUndefined()
    expect(JETTY_FIX_PAGE.jps).toBeUndefined()
  })
})

describe('describeJettyRefresh: what JPS answered to Refresh from JPS', () => {
  it('a rejection that JPS made is shown as a warning, with what KLIP had before', () => {
    const v = describeJettyRefresh({ kind: 'refreshed', status: 'Rejected', previousStatus: 'Pending', changed: true })
    expect(v.tone).toBe('warning')
    expect(v.text).toContain('Rejected')
    expect(v.text).toContain('Pending')
  })

  it('an unchanged answer says nothing changed', () => {
    const v = describeJettyRefresh({ kind: 'refreshed', status: 'Pending', previousStatus: 'Pending', changed: false })
    expect(v.tone).toBe('info')
    expect(v.text).toContain('nothing changed')
  })

  it('a poll inside JPS\'s interval says how long to wait, never "failed"', () => {
    const v = describeJettyRefresh({ kind: 'too_soon', retryInSeconds: 130, status: 'Pending' })
    expect(v.tone).toBe('info')
    expect(v.text).toContain('3 minutes')
  })

  it('no instruction, and a failed call, are told apart', () => {
    expect(describeJettyRefresh({ kind: 'none' }).text).toContain('no instruction')
    const failed = describeJettyRefresh({ kind: 'failed', message: 'UPSTREAM: unavailable' })
    expect(failed.tone).toBe('error')
    expect(failed.text).toContain('UPSTREAM: unavailable')
  })
})

describe('describeJettyResubmit: a rejected instruction can be sent again, as a new one', () => {
  const base = { fromRevision: 1, rejectionReason: 'Berth not available', rejectedAt: '2026-10-27T05:00:00.000Z', payloadUnchanged: false }

  it('gives JPS\'s reason, the date, and says a NEW revision is created and the old one stays as history', () => {
    const v = describeJettyResubmit(base)
    expect(v.title).toContain('2026-10-27')
    expect(v.lines.join('\n')).toContain('Reason from JPS: Berth not available')
    expect(v.lines.join('\n')).toContain('revision 2')
    expect(v.lines.join('\n')).toContain('stays at JPS as history')
    expect(v.warning).toBeNull()
  })

  it('warns when what would be sent is what JPS rejected, but does not forbid it', () => {
    const v = describeJettyResubmit({ ...base, payloadUnchanged: true })
    expect(v.warning).toContain('same as what JPS rejected')
    expect(describeJettyResubmit({ ...base, payloadUnchanged: null }).warning).toBeNull()
  })

  it('without a reason it says so instead of showing an empty line', () => {
    const v = describeJettyResubmit({ ...base, rejectionReason: null, rejectedAt: null })
    expect(v.lines[0]).toContain('no reason')
    expect(v.title).toBe('JPS rejected this instruction')
  })
})
