import { describe, expect, it } from 'vitest'
import { filterPrePlannedGroupsByGlobalScope, type PrePlannedGroup } from '@/lib/prePlannedGroups'

const group = (over: Partial<PrePlannedGroup>) =>
  ({ groupCode: 'G1', groupPlant: 'BONTANG', supplier: 'S', product: 'CPO', incoterm: 'FOB', buyer: 'B', members: [], ...over }) as PrePlannedGroup

const scope = {
  dateFrom: '',
  dateTo: '',
  searchTerm: '',
  selectedIncoterms: [] as string[],
  selectedProducts: [] as string[],
  selectedSuppliers: [] as string[],
  selectedGroupPlants: [] as string[],
}

describe('pre-planned groups under the Discharge Port filter', () => {
  const groups = [group({ groupCode: 'G1' }), group({ groupCode: 'G2', groupPlant: 'BATAM' })]

  it('a group has no shipment yet, so no discharge port: any pick leaves every group out', () => {
    expect(filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedDischargePorts: ['BONTANG'] })).toEqual([])
    expect(filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedDischargePorts: ['Blank'] })).toEqual([])
  })

  it('leaves the groups as they were when no port is picked', () => {
    expect(filterPrePlannedGroupsByGlobalScope(groups, scope)).toHaveLength(2)
    expect(filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedDischargePorts: [] })).toHaveLength(2)
    expect(filterPrePlannedGroupsByGlobalScope(groups, { ...scope, selectedGroupPlants: ['BATAM'] }).map((g) => g.groupCode)).toEqual(['G2'])
  })
})
