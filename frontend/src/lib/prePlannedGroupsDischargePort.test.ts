import { describe, expect, it } from 'vitest'
import { filterPrePlannedGroupsByGlobalScope, hasPrePlannedGlobalScopeFilters, type PrePlannedGroup } from '@/lib/prePlannedGroups'
import { createDischargePortResolver } from '@/lib/dischargePortFilter'

const member = (contractNumber: string, dischargePort?: string) => ({ contractId: contractNumber, contractNumber, osMtAtGrouping: 100, dischargePort })
const group = (groupCode: string, members: ReturnType<typeof member>[], over: Partial<PrePlannedGroup> = {}) =>
  ({ groupCode, groupPlant: 'BONTANG', supplier: 'S', product: 'CPO', incoterm: 'FOB', buyer: 'B', members, ...over }) as PrePlannedGroup

const scope = {
  dateFrom: '',
  dateTo: '',
  searchTerm: '',
  selectedIncoterms: [] as string[],
  selectedProducts: [] as string[],
  selectedSuppliers: [] as string[],
  selectedGroupPlants: [] as string[],
}

const resolver = createDischargePortResolver([
  { identity: 'BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
])

describe('a Discharge Port pick is a scope filter for the pre-planned groups', () => {
  it('is counted, so the page knows the suggestions are scoped', () => {
    expect(hasPrePlannedGlobalScopeFilters(scope)).toBe(false)
    expect(hasPrePlannedGlobalScopeFilters({ ...scope, selectedDischargePorts: [] })).toBe(false)
    expect(hasPrePlannedGlobalScopeFilters({ ...scope, selectedDischargePorts: ['PORT DUMAI'] })).toBe(true)
  })
})

describe('pre-planned groups under the Discharge Port filter', () => {
  const groups = [
    group('G1', [member('C1', 'EUP EDIBLE OIL BONTANG'), member('C2', 'EUP EDIBLE OIL BONTANG')]),
    group('G2', [member('C3', 'PORT DUMAI')], { groupPlant: 'RIAU' }),
    group('G3', [member('C4', 'PORT DUMAI'), member('C5')]),
    group('G4', []),
  ]
  const codes = (picks: string[], r: typeof resolver = null) =>
    filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedDischargePorts: picks, dischargePortResolver: r }).map((g) => g.groupCode)

  it('a group stays when ANY member\'s SAP port is a picked one', () => {
    expect(codes(['PORT DUMAI'])).toEqual(['G2', 'G3'])
    expect(codes(['EUP EDIBLE OIL BONTANG'])).toEqual(['G1'])
  })

  it('through the Master Port mapping, a member whose port is a plant name is found by its port', () => {
    expect(codes(['PORT BONTANG'], resolver)).toEqual(['G1'])
    expect(codes(['PORT BONTANG'])).toEqual([])
  })

  it('Blank finds a group with a member that has no SAP port; a group with no member has no port to match', () => {
    expect(codes(['Blank'])).toEqual(['G3'])
  })

  it('leaves the groups as they were when no port is picked, and combines with the other toolbar filters', () => {
    expect(filterPrePlannedGroupsByGlobalScope(groups, scope)).toHaveLength(4)
    expect(filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedDischargePorts: [] })).toHaveLength(4)
    expect(
      filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedDischargePorts: ['PORT DUMAI'], selectedGroupPlants: ['RIAU'] }).map((g) => g.groupCode),
    ).toEqual(['G2'])
  })
})
