import { describe, expect, it } from 'vitest'
import { commercialAppDestination, commercialDocsUrl, movedPageUrl, withoutMovedPages } from './commercialDocsApp'
import { ALL_NAV_ITEMS } from './navigationConfig'

const APP = 'http://172.28.92.56:8081'
const view = { canView: true, canCreate: false, canEdit: false, canDelete: false }

describe('Commercial Documents go-live switch', () => {
  it('is off unless the variable holds an http(s) origin', () => {
    expect(commercialDocsUrl('')).toBeNull()
    expect(commercialDocsUrl(undefined)).toBeNull()
    expect(commercialDocsUrl('docs.example')).toBeNull()
    expect(commercialDocsUrl(' http://172.28.92.56:8081/ ')).toBe(APP)
  })

  it('off: KLIP keeps both Commercial menus', () => {
    expect(withoutMovedPages(ALL_NAV_ITEMS, null)).toHaveLength(ALL_NAV_ITEMS.length)
    expect(movedPageUrl('/commercial-documents', null)).toBeNull()
  })

  it('on: only the two Commercial menus leave KLIP', () => {
    const left = withoutMovedPages(ALL_NAV_ITEMS, APP).map((i) => i.href)
    expect(left).not.toContain('/commercial-documents')
    expect(left).not.toContain('/commercial-dashboard')
    expect(left).toHaveLength(ALL_NAV_ITEMS.length - 2)
    expect(left).toContain('/documents')
  })

  it('on: old addresses forward to the same page in the new app', () => {
    expect(movedPageUrl('/commercial-documents', APP)).toBe(`${APP}/documents`)
    expect(movedPageUrl('/commercial-dashboard/', APP)).toBe(`${APP}/dashboard`)
    expect(movedPageUrl('/documents', APP)).toBeNull()
  })

  it('a user with no KLIP page goes to the new app only when the role may open a page there', () => {
    expect(commercialAppDestination({ loaded: true, byKey: { 'page.commercial_documents': view } }, APP)).toBe(`${APP}/`)
    expect(commercialAppDestination({ loaded: true, byKey: { 'page.commercial_dashboard': view } }, APP)).toBe(`${APP}/`)
    expect(commercialAppDestination({ loaded: true, byKey: {} }, APP)).toBeNull()
    expect(commercialAppDestination({ loaded: true, byKey: { 'page.commercial_documents': view } }, null)).toBeNull()
  })
})
