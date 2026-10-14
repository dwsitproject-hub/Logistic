import { afterEach, describe, expect, it } from 'vitest'
import { createDischargePortResolver } from '@/lib/dischargePortFilter'
import { displayPortLabel, masterPortOf, normalizeListPortIdentity, setPortDisplayResolver } from '@/lib/portDisplay'
import { resolveShipmentListDischargePorts } from '@/lib/shipmentListPorts'
import { applySection3PortDisplay, type ShippingPerformancePortSource } from '@/lib/shippingPerformancePorts'

const displayed = (row: ShippingPerformancePortSource) => applySection3PortDisplay(row).discharge_port

/** What GET /contracts/filter-options/discharge-port-map returns for a slice of the Master Port and its VESSEL PORT (SAP) names. */
const resolver = createDischargePortResolver([
  { identity: 'BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'PABRIK AJP', canonical: 'PORT BONTANG' },
  { identity: 'DUMAI', canonical: 'PORT DUMAI' },
])

afterEach(() => setPortDisplayResolver(null))

describe('portDisplay', () => {
  it('draws every text as it is until a map is set (not loaded yet, or failed)', () => {
    expect(masterPortOf('EUP EDIBLE OIL BONTANG')).toBeNull()
    expect(displayPortLabel('EUP EDIBLE OIL BONTANG')).toBe('EUP EDIBLE OIL BONTANG')
  })

  it('draws a text as its Master Port when it has one, and as the original text when it has none', () => {
    setPortDisplayResolver(resolver)
    expect(displayPortLabel('EUP EDIBLE OIL BONTANG')).toBe('PORT BONTANG')
    expect(displayPortLabel('pabrik  ajp')).toBe('PORT BONTANG')
    expect(displayPortLabel('Port of Bontang')).toBe('PORT BONTANG')
    // a trading plant nobody mapped keeps its SAP wording
    expect(displayPortLabel('EUP TRADING PLANT')).toBe('EUP TRADING PLANT')
    expect(masterPortOf('')).toBeNull()
    expect(masterPortOf(null)).toBeNull()
  })

  it('the identity rule is the one the Shipments list de-duplicates by', () => {
    expect(normalizeListPortIdentity('Port of Bontang')).toBe('BONTANG')
    expect(normalizeListPortIdentity('PELABUHAN  DUMAI')).toBe('DUMAI')
    expect(normalizeListPortIdentity('EUP EDIBLE OIL BONTANG')).toBe('EUP EDIBLE OIL BONTANG')
  })
})

describe('Shipments list discharge port is drawn as its Master Port', () => {
  const row = (over: Record<string, unknown>) => over as Parameters<typeof resolveShipmentListDischargePorts>[0]

  it('without a map the list is exactly what it was', () => {
    expect(resolveShipmentListDischargePorts(row({ discharge_ports_klip: 'EUP EDIBLE OIL BONTANG' }))).toBe('EUP EDIBLE OIL BONTANG')
  })

  it('with the map each port becomes its Master Port, two texts of one port become one, an unmapped text stays', () => {
    setPortDisplayResolver(resolver)
    expect(resolveShipmentListDischargePorts(row({ discharge_ports_klip: 'EUP EDIBLE OIL BONTANG' }))).toBe('PORT BONTANG')
    expect(resolveShipmentListDischargePorts(row({ discharge_ports_klip: 'EUP EDIBLE OIL BONTANG, PABRIK AJP, PORT DUMAI' }))).toBe('PORT BONTANG, PORT DUMAI')
    expect(resolveShipmentListDischargePorts(row({ discharge_ports_klip: 'EUP TRADING PLANT' }))).toBe('EUP TRADING PLANT')
    expect(resolveShipmentListDischargePorts(row({ discharge_ports_klip: '' }))).toBe('')
  })

  it("the ending B2B child's port still replaces every other port, then is drawn as its Master Port", () => {
    setPortDisplayResolver(resolver)
    expect(resolveShipmentListDischargePorts(row({ discharge_port_b2b_child: 'EUP EDIBLE OIL BONTANG', discharge_ports_klip: 'EUP TRADING PLANT' }))).toBe('PORT BONTANG')
  })

  it('a closed contract still prefers SAP, and it too is drawn as its Master Port', () => {
    setPortDisplayResolver(resolver)
    expect(
      resolveShipmentListDischargePorts(row({ is_contract_sap_closed: true, sap_discharge_ports: 'PABRIK AJP', discharge_ports_klip: 'PORT DUMAI' })),
    ).toBe('PORT BONTANG')
  })
})

describe('Shipping Performance section 3 discharge port is drawn as its Master Port', () => {
  it('uses the first text that has a Master Port (the one the filter reads), else the text the table always showed', () => {
    setPortDisplayResolver(resolver)
    expect(displayed({ sap_vessel_discharge_port: 'EUP TRADING PLANT', port_of_discharge: 'PORT DUMAI' })).toBe('PORT DUMAI')
    expect(displayed({ sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG' })).toBe('PORT BONTANG')
    expect(displayed({ sap_vessel_discharge_port: 'EUP TRADING PLANT' })).toBe('EUP TRADING PLANT')
    expect(displayed({})).toBeNull()
  })

  it('without a map it is exactly what it was', () => {
    expect(displayed({ sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG', port_of_discharge: 'PORT DUMAI' })).toBe('EUP EDIBLE OIL BONTANG')
  })
})
