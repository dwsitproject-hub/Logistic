import { describe, expect, it } from 'vitest'
import {
  appendClaimSusutFilterParams,
  buildNextClaimSusutDrilldownSelection,
  CLAIM_SUSUT_DEFAULT_VISIBLE_IDS,
  CLAIM_SUSUT_COLUMNS,
  EMPTY_CLAIM_SUSUT_DRILLDOWN,
  looksLikeLegacyAllVisibleClaimSusutColumns,
  parseClaimSusutImportErrors,
  claimSusutImportFailedCount,
  claimSusutImportSuccessRate,
  claimSusutImportStatus,
} from './claimSusutView'

describe('Claim Susut view helpers', () => {
  it('defaults the view table to CR / company / qty / amount / aging columns', () => {
    expect([...CLAIM_SUSUT_DEFAULT_VISIBLE_IDS]).toEqual([
      'crno',
      'cr_date',
      'group_of_transport',
      'vendor_name',
      'commodity',
      'dest',
      'po_number',
      'qty_claim',
      'amount_after_tax_idr',
      'os_days',
      'payment_method',
    ])
    const companyCol = CLAIM_SUSUT_COLUMNS.find((c) => c.id === 'vendor_name')
    expect(companyCol?.label).toBe('Company')
  })

  it('clears deeper drilldown levels when a parent is chosen', () => {
    const next = buildNextClaimSusutDrilldownSelection(
      { product: 'CPO', plant: 'BONTANG', incoterm: 'FOB', company: 'PT A' },
      'plant',
      'DUMAI',
    )
    expect(next).toEqual({ product: 'CPO', plant: 'DUMAI', incoterm: null, company: null })
  })

  it('sends drilldown and group filters as dedicated query params', () => {
    const params = appendClaimSusutFilterParams(new URLSearchParams(), {
      importId: 'imp-1',
      plants: ['BONTANG'],
      groupOfTransport: 'TRUCK',
      drilldown: { ...EMPTY_CLAIM_SUSUT_DRILLDOWN, product: 'CPO', company: 'PT A' },
    })
    expect(params.get('importId')).toBe('imp-1')
    expect(params.getAll('plant')).toEqual(['BONTANG'])
    expect(params.get('ddProduct')).toBe('CPO')
    expect(params.get('ddCompany')).toBe('PT A')
    expect(params.get('groupOfTransport')).toBe('TRUCK')

    const summaryParams = appendClaimSusutFilterParams(
      new URLSearchParams(),
      {
        groupOfTransport: 'TRUCK',
        drilldown: { ...EMPTY_CLAIM_SUSUT_DRILLDOWN, product: 'CPO' },
      },
      { includeDrilldown: false, includeGroup: false },
    )
    expect(summaryParams.get('ddProduct')).toBeNull()
    expect(summaryParams.get('groupOfTransport')).toBeNull()
  })

  it('treats a previous all-columns preference as the compact default', () => {
    const legacy = CLAIM_SUSUT_COLUMNS.filter((c) => c.id !== 'incoterm' && c.id !== 'region_plant').map(
      (c) => c.id,
    )
    expect(looksLikeLegacyAllVisibleClaimSusutColumns(legacy)).toBe(true)
    expect(looksLikeLegacyAllVisibleClaimSusutColumns(['crno', 'vendor_name'])).toBe(false)
  })

  it('parses import errors and success rate for history details', () => {
    expect(parseClaimSusutImportErrors([{ rowIndex: 4, message: 'blank PO' }])).toEqual([
      { rowIndex: 4, message: 'blank PO' },
    ])
    expect(claimSusutImportFailedCount([{ rowIndex: 1, message: 'x' }], 10, 9)).toBe(1)
    expect(claimSusutImportFailedCount(null, 10, 8)).toBe(2)
    expect(claimSusutImportSuccessRate(10, 8)).toBe(80)
    expect(claimSusutImportStatus(8, 2)).toBe('partial')
    expect(claimSusutImportStatus(10, 0)).toBe('completed')
    expect(claimSusutImportStatus(0, 3)).toBe('failed')
  })
})
