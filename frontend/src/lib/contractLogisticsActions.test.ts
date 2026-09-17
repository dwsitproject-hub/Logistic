import { describe, expect, it } from 'vitest'
import {
  contractShowsAddShipment,
  contractShowsAddTrucking,
  normalizeContractIncoterm,
} from './contractLogisticsActions'

describe('contractLogisticsActions', () => {
  it('normalizes incoterm case and whitespace', () => {
    expect(normalizeContractIncoterm(' cif ')).toBe('CIF')
    expect(normalizeContractIncoterm(null)).toBe('')
  })

  it('shows Add Shipment for FOB, CIF, CFR only', () => {
    expect(contractShowsAddShipment('FOB')).toBe(true)
    expect(contractShowsAddShipment('cif')).toBe(true)
    expect(contractShowsAddShipment('CFR')).toBe(true)
    expect(contractShowsAddShipment('FRC')).toBe(false)
    expect(contractShowsAddShipment('LCO')).toBe(false)
    expect(contractShowsAddShipment('DAP')).toBe(false)
    expect(contractShowsAddShipment('')).toBe(false)
  })

  it('shows Add Trucking for FRC, LCO only', () => {
    expect(contractShowsAddTrucking('FRC')).toBe(true)
    expect(contractShowsAddTrucking('lco')).toBe(true)
    expect(contractShowsAddTrucking('FOB')).toBe(false)
    expect(contractShowsAddTrucking('CIF')).toBe(false)
    expect(contractShowsAddTrucking('CFR')).toBe(false)
    expect(contractShowsAddTrucking('DAP')).toBe(false)
    expect(contractShowsAddTrucking('')).toBe(false)
  })

  it('never shows both shipment and trucking for the same incoterm', () => {
    const all = ['FOB', 'CIF', 'CFR', 'FRC', 'LCO', 'DAP', 'EXW', '']
    for (const inc of all) {
      expect(contractShowsAddShipment(inc) && contractShowsAddTrucking(inc)).toBe(false)
    }
  })
})
