import { describe, expect, it } from 'vitest'
import { commercialAppDestination, commercialDocumentsAppUrl, commdocsDocumentsMoved, commdocsUrl, movedPageUrl, withoutMovedPages } from './commdocsApp'
import { ALL_NAV_ITEMS } from './navigationConfig'

const APP = 'http://test-commercial-docs.kpndomain.com'
const view = { canView: true, canCreate: false, canEdit: false, canDelete: false }

describe('Commercial Documents go-live switch', () => {
  it('is off unless the variable holds an http(s) origin', () => {
    expect(commdocsUrl('')).toBeNull()
    expect(commdocsUrl(undefined)).toBeNull()
    expect(commdocsUrl('docs.example')).toBeNull()
    expect(commdocsUrl(' http://test-commercial-docs.kpndomain.com/ ')).toBe(APP)
  })

  it('the second step is off unless the variable says true', () => {
    expect(commdocsDocumentsMoved('')).toBe(false)
    expect(commdocsDocumentsMoved(undefined)).toBe(false)
    expect(commdocsDocumentsMoved('false')).toBe(false)
    expect(commdocsDocumentsMoved('true')).toBe(true)
    expect(commdocsDocumentsMoved(' 1 ')).toBe(true)
  })

  it('no address: KLIP keeps both Commercial menus, whatever the second step says', () => {
    expect(withoutMovedPages(ALL_NAV_ITEMS, null, false)).toHaveLength(ALL_NAV_ITEMS.length)
    expect(withoutMovedPages(ALL_NAV_ITEMS, null, true)).toHaveLength(ALL_NAV_ITEMS.length)
    expect(movedPageUrl('/commercial-documents', null, true)).toBeNull()
    expect(movedPageUrl('/commercial-dashboard', null, false)).toBeNull()
  })

  it('address set, second step off: only Commercial Dashboard leaves KLIP; Commercial Documents stays', () => {
    const left = withoutMovedPages(ALL_NAV_ITEMS, APP, false).map((i) => i.href)
    expect(left).not.toContain('/commercial-dashboard')
    expect(left).toContain('/commercial-documents')
    expect(left).toHaveLength(ALL_NAV_ITEMS.length - 1)
    expect(left).toContain('/users')
  })

  it('address set, second step on: both Commercial menus leave KLIP', () => {
    const left = withoutMovedPages(ALL_NAV_ITEMS, APP, true).map((i) => i.href)
    expect(left).not.toContain('/commercial-documents')
    expect(left).not.toContain('/commercial-dashboard')
    expect(left).toHaveLength(ALL_NAV_ITEMS.length - 2)
  })

  it('the dashboard address forwards from the first step; the documents address only from the second', () => {
    expect(movedPageUrl('/commercial-dashboard/', APP, false)).toBe(`${APP}/dashboard`)
    expect(movedPageUrl('/commercial-documents', APP, false)).toBeNull()
    expect(movedPageUrl('/commercial-documents', APP, true)).toBe(`${APP}/documents`)
    expect(movedPageUrl('/documents', APP, true)).toBeNull()
  })

  it('the notice on Commercial Documents points to the documents page of the app, and to nothing when no address is set', () => {
    expect(commercialDocumentsAppUrl(APP)).toBe(`${APP}/documents`)
    expect(commercialDocumentsAppUrl(null)).toBeNull()
  })

  it('a user with no KLIP page goes to the new app only when the role may open a page there', () => {
    expect(commercialAppDestination({ loaded: true, byKey: { 'page.commercial_documents': view } }, APP)).toBe(`${APP}/`)
    expect(commercialAppDestination({ loaded: true, byKey: { 'page.commercial_dashboard': view } }, APP)).toBe(`${APP}/`)
    expect(commercialAppDestination({ loaded: true, byKey: {} }, APP)).toBeNull()
    expect(commercialAppDestination({ loaded: true, byKey: { 'page.commercial_documents': view } }, null)).toBeNull()
  })
})
