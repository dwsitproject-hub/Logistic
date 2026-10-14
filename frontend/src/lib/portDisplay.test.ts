import { afterEach, describe, expect, it } from 'vitest'
import { createDischargePortResolver } from '@/lib/dischargePortFilter'
import { displayPortLabel, masterPortOf, normalizeListPortIdentity, setPortDisplayResolver } from '@/lib/portDisplay'
import { resolveShipmentListDischargePorts } from '@/lib/shipmentListPorts'
import { applySection3PortDisplay, displayShippingPerfDischargePort, displayShippingPerfLoadingPort, type ShippingPerformancePortSource } from '@/lib/shippingPerformancePorts'
import { shippingPerfCellTooltipText } from '@/lib/shippingPerformanceTableUi'
import { resolveShipmentListLoadingPorts } from '@/lib/shipmentListPorts'

const displayed = (row: ShippingPerformancePortSource) => applySection3PortDisplay(row).discharge_port

/** What GET /contracts/filter-options/discharge-port-map returns for a slice of the Master Port and its VESSEL PORT (SAP) names. */
const resolver = createDischargePortResolver([
  { identity: 'BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'PABRIK AJP', canonical: 'PORT BONTANG' },
  { identity: 'DUMAI', canonical: 'PORT DUMAI' },
  { identity: 'BONEMANJING', canonical: 'PORT BONE MANJING' },
  { identity: 'ASIKE', canonical: 'PORT ASIKE' },
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
describe('the table cells draw the same port as applySection3PortDisplay (the SP cell recomputed the raw text before)', () => {
  it('discharge: the cell function and the tooltip give the Master Port, else the original text', () => {
    setPortDisplayResolver(resolver)
    const row = { sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG' }
    expect(displayShippingPerfDischargePort(row)).toBe('PORT BONTANG')
    expect(shippingPerfCellTooltipText('discharge_port', row as never)).toBe('PORT BONTANG')
    expect(displayShippingPerfDischargePort({ sap_vessel_discharge_port: 'EUP TRADING PLANT' })).toBe('EUP TRADING PLANT')
  })

  it('loading: a SAP text that is a Master Port name or one of its SAP names is drawn as the port; a mill nobody mapped stays as SAP wrote it', () => {
    setPortDisplayResolver(resolver)
    expect(displayShippingPerfLoadingPort({ sap_vessel_loading_port_1: 'PORT OF BONEMANJING' })).toBe('PORT BONE MANJING')
    expect(displayShippingPerfLoadingPort({ sap_vessel_loading_port_1: 'Port Asike' })).toBe('PORT ASIKE')
    expect(displayShippingPerfLoadingPort({ sap_vessel_loading_port_1: 'PKS MAJU KALIMANTAN' })).toBe('PKS MAJU KALIMANTAN')
    expect(shippingPerfCellTooltipText('loading_port', { sap_vessel_loading_port_1: 'PORT OF BONEMANJING' } as never)).toBe('PORT BONE MANJING')
    expect(applySection3PortDisplay<ShippingPerformancePortSource>({ sap_vessel_loading_port_1: 'PORT OF BONEMANJING' }).loading_port).toBe('PORT BONE MANJING')
  })

  it('loading: the first text that has a Master Port wins over a first text that has none', () => {
    setPortDisplayResolver(resolver)
    expect(displayShippingPerfLoadingPort({ sap_vessel_loading_port_1: 'PKS MAJU KALIMANTAN', port_of_loading: 'PORT ASIKE' })).toBe('PORT ASIKE')
  })

  it('without a map nothing changes', () => {
    expect(displayShippingPerfLoadingPort({ sap_vessel_loading_port_1: 'PORT OF BONEMANJING' })).toBe('PORT OF BONEMANJING')
  })

  it('Shipments list loading ports are drawn as Master Ports too, one entry per port, unmapped texts as they are', () => {
    setPortDisplayResolver(resolver)
    const row = (over: Record<string, unknown>) => over as Parameters<typeof resolveShipmentListLoadingPorts>[0]
    expect(resolveShipmentListLoadingPorts(row({ loading_ports_klip: 'PORT OF BONEMANJING, PKS MAJU KALIMANTAN' }))).toBe('PORT BONE MANJING, PKS MAJU KALIMANTAN')
    expect(resolveShipmentListLoadingPorts(row({ loading_ports_klip: 'Port Asike, PORT ASIKE' }))).toBe('PORT ASIKE')
  })
})
