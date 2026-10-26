import { describe, expect, it } from 'vitest'
import { accessFor, homePath, navKeyForPath } from './access'
import { fileNameFromDisposition, toQuery } from './api'
import { auditGroupFilter, describeAudit } from './audit'
import { canonicalType, documentKey, isB2bOrigin, typesDone, uploadProblem, versionsOf } from './documentTypes'
import { ddmmyy, ddmmyyyy, pageList, parseDdMmYyyy, pct, presetRange, priceCell } from './format'
import { toCsv } from './files'
import type { AuditEntry, DocumentFile, DocumentRow } from './types'

const flags = { canView: true, canCreate: false, canEdit: false, canDelete: false }

describe('access mirrors the API gates', () => {
  it('a document-only role sees Documents, uploads only its granted types, cannot delete or administer', () => {
    const a = accessFor('BC', {
      'page.commercial_documents': flags,
      'data.commercial_documents.upload.bea_cukai': { ...flags, canCreate: true },
    })
    expect(a.documents).toBe(true)
    expect(a.dashboard).toBe(false)
    expect(a.upload('bea_cukai')).toBe(true)
    expect(a.upload('contract')).toBe(false)
    expect(a.deleteFiles).toBe(false)
    expect([a.users, a.roles, a.audit]).toEqual([false, false, false])
    expect(homePath(a)).toBe('/documents')
  })

  it('edit on an upload key is enough, as in the controller', () => {
    expect(accessFor('X', { 'data.commercial_documents.upload.contract': { ...flags, canEdit: true } }).upload('contract')).toBe(true)
  })

  it('ADMIN passes everything; SUPPORT and ADMIN_SUPPORT get the audit trail only', () => {
    const admin = accessFor('ADMIN', {})
    expect([admin.documents, admin.dashboard, admin.users, admin.roles, admin.audit, admin.deleteFiles]).toEqual([
      true, true, true, true, true, true,
    ])
    expect(accessFor('ADMIN_SUPPORT', {}).audit).toBe(true)
    expect(accessFor('SUPPORT', {}).users).toBe(false)
  })

  it('a role with no page here has no home', () => {
    expect(homePath(accessFor('LOGISTICS', { 'page.shipments': flags }))).toBeNull()
  })

  it('maps paths to pages', () => {
    expect(navKeyForPath('/documents')).toBe('documents')
    expect(navKeyForPath('/roles')).toBe('roles')
    expect(navKeyForPath('/elsewhere')).toBeNull()
  })
})

describe('dates', () => {
  it('reads a DATE column as that calendar day in any timezone', () => {
    expect(ddmmyy('2026-07-23')).toBe('23/07/26')
    expect(ddmmyy('2026-07-23T00:00:00.000Z')).toBe('23/07/26')
    expect(ddmmyy(null)).toBe('-')
    expect(ddmmyyyy('2026-10-26')).toBe('26/10/2026')
  })

  it('parses a typed dd/mm/yyyy Send Date and rejects impossible dates', () => {
    expect(parseDdMmYyyy('26/10/2026')).toBe('2026-10-26')
    expect(parseDdMmYyyy('1/2/2026')).toBe('2026-02-01')
    expect(parseDdMmYyyy('31/02/2026')).toBeNull()
    expect(parseDdMmYyyy('2026-10-26')).toBeNull()
  })

  it('presets resolve to YYYY-MM-DD ranges', () => {
    const today = new Date(2026, 9, 26)
    expect(presetRange('ytd', today)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-10-26' })
    expect(presetRange('lastYear', today)).toEqual({ dateFrom: '2025-01-01', dateTo: '2025-12-31' })
    expect(presetRange('last30', today)?.dateFrom).toBe('2026-09-26')
    expect(presetRange('custom', today)).toBeNull()
  })
})

describe('numbers and pages', () => {
  it('prices: number only in IDR, code kept otherwise', () => {
    expect(priceCell(15690, 'IDR')).toBe('15,690')
    expect(priceCell(15690, null)).toBe('15,690')
    expect(priceCell(820, 'usd')).toBe('820 USD')
    expect(priceCell(null, 'IDR')).toBe('-')
  })

  it('percent to one decimal, zero total is 0', () => {
    expect(pct(1, 3)).toBe(33.3)
    expect(pct(5, 0)).toBe(0)
  })

  it('page buttons with gaps', () => {
    expect(pageList(1, 1)).toEqual([1])
    expect(pageList(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10])
    expect(pageList(2, 4)).toEqual([1, 2, 3, 4])
  })
})

describe('documents', () => {
  const row = (over: Partial<DocumentRow> = {}) =>
    ({ po_number: '1001', contract_id: 'c1', doc_contract: true, doc_bea_cukai: true, b2b_flag: null, contract_reference_po: null, ...over }) as DocumentRow

  it('counts the nine flags', () => {
    expect(typesDone(row())).toBe(2)
  })

  it('maps legacy stored types onto the checklist', () => {
    expect(canonicalType('ep_pelunasan')).toBe('invoice_fp_payoff')
    expect(canonicalType('faktur_pajak')).toBeNull()
    const files = [
      { id: '1', document_type: 'invoice_dp' },
      { id: '2', document_type: 'invoice_fp_dp' },
      { id: '3', document_type: 'contract' },
    ] as DocumentFile[]
    expect(versionsOf(files, 'invoice_fp_dp').map((f) => f.id)).toEqual(['1', '2'])
  })

  it('files are keyed by PO, or the contract id without one', () => {
    expect(documentKey(row())).toBe('1001')
    expect(documentKey(row({ po_number: null }))).toBe('c1')
  })

  it('only PDF, except images for Invoice + FP (Full Receive); 15 MB max', () => {
    const pdf = { name: 'a.pdf', type: 'application/pdf', size: 1000 }
    const png = { name: 'a.png', type: 'image/png', size: 1000 }
    expect(uploadProblem('contract', pdf)).toBeNull()
    expect(uploadProblem('contract', png)).toMatch(/Only PDF/)
    expect(uploadProblem('invoice_fp_full', png)).toBeNull()
    expect(uploadProblem('contract', { ...pdf, size: 16 * 1024 * 1024 })).toMatch(/15 MB/)
  })

  it('B2B origin = flagged B2B without a reference PO', () => {
    expect(isB2bOrigin(row({ b2b_flag: 'Yes' }))).toBe(true)
    expect(isB2bOrigin(row({ b2b_flag: 'B2B', contract_reference_po: '9' }))).toBe(false)
  })
})

describe('api helpers', () => {
  it('repeats array keys and drops empty values', () => {
    expect(toQuery({ product: ['CPO', 'PK'], plant: [], search: '', page: 1, x: null })).toBe('?product=CPO&product=PK&page=1')
    expect(toQuery({})).toBe('')
  })

  it('reads the file name of a download', () => {
    expect(fileNameFromDisposition('attachment; filename="Tanda_Terima_2026-10-26.pdf"')).toBe('Tanda_Terima_2026-10-26.pdf')
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''A%20B.pdf")).toBe('A B.pdf')
    expect(fileNameFromDisposition(null)).toBeNull()
  })

  it('CSV quotes and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=SUM(A1)'], [-5, 'say "hi"']])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n-5,"say ""hi"""')
  })
})

describe('audit trail wording', () => {
  const entry = (over: Partial<AuditEntry>): AuditEntry =>
    ({ id: '1', user_id: 'u', username: 'rina', full_name: 'Rina', role: 'BC', entity_id: null, before_data: null, after_data: null, timestamp: '', ...over }) as AuditEntry

  it('describes a document upload', () => {
    const d = describeAudit(
      entry({ action: 'UPLOAD', entity_type: 'COMMERCIAL_DOCUMENT', after_data: { po_number: '1001', document_type: 'bea_cukai', file_name: 'B.pdf', action_type: 'EDIT' } }),
    )
    expect(d).toEqual({ action: 'Uploaded new version', tone: 'ok', what: 'Bea Cukai', details: 'PO 1001 · B.pdf' })
  })

  it('describes a Tanda Terima download and names a changed role', () => {
    expect(
      describeAudit(entry({ action: 'DOWNLOAD_TANDA_TERIMA', entity_type: 'COMMERCIAL_DOCUMENT', after_data: { contract_ext_nos: ['A', 'B'], send_date: '2026-10-26' } })).details,
    ).toBe('2 contracts · send date 2026-10-26 · A, B')
    expect(describeAudit(entry({ action: 'UPDATE', entity_type: 'ROLE_PERMISSIONS', entity_id: 'r1' }), { r1: 'Bea Cukai' }).what).toBe('Bea Cukai')
  })

  it('groups filter on action and entity type', () => {
    expect(auditGroupFilter('deleted')).toEqual({ action: ['DELETE'], entityType: ['COMMERCIAL_DOCUMENT'] })
    expect(auditGroupFilter('all').action).toBeUndefined()
  })
})
