import { describe, expect, it } from 'vitest'
import { formatCommercialSapAmount } from './commercialDocumentsFormat'
import {
  COMMERCIAL_DOCS_ALL_COLUMNS,
  COMMERCIAL_DOCS_COLUMN_BY_ID,
  COMMERCIAL_DOCS_DEFAULT_VISIBLE_COLUMNS,
  COMMERCIAL_DOCS_HIDDEN_BY_DEFAULT_COLUMNS,
} from './commercialDocumentsColumns'

const OA_IDS = ['vessel_oa_budget', 'vessel_oa_actual', 'truck_oa_budget', 'truck_oa_actual'] as const

describe('SAP OA columns in the Commercial Documents table', () => {
  it('exist, hidden by default, and can be shown from the Columns menu', () => {
    for (const id of OA_IDS) {
      const column = COMMERCIAL_DOCS_COLUMN_BY_ID[id]
      expect(column).toBeDefined()
      expect(column.defaultVisible).toBe(false)
      expect(column.sortable).toBe(true)
      expect((COMMERCIAL_DOCS_HIDDEN_BY_DEFAULT_COLUMNS as readonly string[]).includes(id)).toBe(true)
      expect((COMMERCIAL_DOCS_DEFAULT_VISIBLE_COLUMNS as readonly string[]).includes(id)).toBe(false)
      expect(COMMERCIAL_DOCS_ALL_COLUMNS.some((c) => c.id === id)).toBe(true)
    }
    expect(OA_IDS.map((id) => COMMERCIAL_DOCS_COLUMN_BY_ID[id].label)).toEqual([
      'Vessel OA Budget',
      'Vessel OA Actual',
      'Truck OA Budget',
      'Truck OA Actual',
    ])
  })

  it('show the SAP amount, a dash when SAP sent none, and 0 as 0', () => {
    expect(formatCommercialSapAmount(1234567.5)).toBe('1,234,567.5')
    expect(formatCommercialSapAmount(0)).toBe('0')
    expect(formatCommercialSapAmount(null)).toBe('-')
    expect(formatCommercialSapAmount(undefined)).toBe('-')
  })

  it('sort a missing amount below every real one', () => {
    const column = COMMERCIAL_DOCS_COLUMN_BY_ID.vessel_oa_budget
    const missing = column.getSortValue?.({ vessel_oa_budget: null } as never) as number
    const zero = column.getSortValue?.({ vessel_oa_budget: 0 } as never) as number
    expect(missing).toBeLessThan(zero)
  })
})
