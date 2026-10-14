import { describe, expect, it } from 'vitest'
import {
  resolveShipmentListDischargePorts,
  resolveShipmentListLoadingPorts,
} from './shipmentListPorts'

describe('shipmentListPorts', () => {
  it('Open: prefers KLIP over SAP', () => {
    expect(
      resolveShipmentListLoadingPorts({
        is_contract_sap_closed: false,
        sap_loading_ports: 'PORT OF BONEMANJING',
        loading_ports_klip: 'Bonemanjing',
      }),
    ).toBe('Bonemanjing')
  })

  it('Closed: prefers SAP over KLIP', () => {
    expect(
      resolveShipmentListLoadingPorts({
        is_contract_sap_closed: true,
        sap_loading_ports: 'Port A, Port B',
        port_of_loading: 'Port C',
        loading_ports_klip: 'Port D',
      }),
    ).toBe('Port A, Port B')
  })

  it('a contract-backlog row (no shipment: port columns NULL) reads the SAP ports - what Add New Shipment is prefilled with', () => {
    const backlogRow = {
      is_contract_sap_closed: false,
      port_of_loading: null,
      port_of_discharge: null,
      sap_loading_ports: 'PKS PAGUN/PARBA',
      sap_discharge_ports: 'EUP EDIBLE OIL TJ.PURA',
    }
    expect(resolveShipmentListLoadingPorts(backlogRow)).toBe('PKS PAGUN/PARBA')
    expect(resolveShipmentListDischargePorts(backlogRow)).toBe('EUP EDIBLE OIL TJ.PURA')
  })

  it('Open: falls back to SAP when KLIP empty', () => {
    expect(
      resolveShipmentListLoadingPorts({
        is_contract_sap_closed: false,
        sap_loading_ports: 'Belawan',
        loading_ports_klip: '',
      }),
    ).toBe('Belawan')
  })

  it('falls back to port_of_loading when SAP and vlp agg are empty', () => {
    expect(
      resolveShipmentListLoadingPorts({
        is_contract_sap_closed: false,
        port_of_loading: 'Jakarta',
      }),
    ).toBe('Jakarta')
  })

  it('Closed: uses SAP Vessel Discharge Port before KLIP discharge', () => {
    expect(
      resolveShipmentListDischargePorts({
        is_contract_sap_closed: true,
        sap_discharge_ports: 'Surabaya',
        port_of_discharge: 'Jakarta',
      }),
    ).toBe('Surabaya')
  })

  it('Open: prefers KLIP discharge over SAP', () => {
    expect(
      resolveShipmentListDischargePorts({
        is_contract_sap_closed: false,
        sap_discharge_ports: 'Surabaya',
        discharge_ports_klip: 'Jakarta',
      }),
    ).toBe('Jakarta')
  })

  it('skips numeric SAP port codes and uses KLIP fallback', () => {
    expect(
      resolveShipmentListDischargePorts({
        is_contract_sap_closed: true,
        sap_discharge_ports: '74.66',
        port_of_discharge: 'Jakarta',
      }),
    ).toBe('Jakarta')
  })

  it('skips generic KLIP placeholders and uses real shipment discharge port', () => {
    expect(
      resolveShipmentListDischargePorts({
        is_contract_sap_closed: false,
        discharge_ports_klip: 'Discharge Port',
        port_of_discharge: 'PORT TANJUNG PRIOK',
      }),
    ).toBe('PORT TANJUNG PRIOK')
  })

  it('skips generic loading placeholder and falls back to empty when no real port', () => {
    expect(
      resolveShipmentListLoadingPorts({
        is_contract_sap_closed: false,
        loading_ports_klip: 'Loading Port 1',
        port_of_loading: 'Loading Port 1',
      }),
    ).toBe('')
  })

  it('collapses PORT OF X with X when both appear in one priority tier', () => {
    expect(
      resolveShipmentListLoadingPorts({
        is_contract_sap_closed: false,
        loading_ports_klip: 'Bonemanjing, PORT OF BONEMANJING',
      }),
    ).toBe('Bonemanjing')
  })
})

describe('shipmentListPorts: a B2B origin is at its ending child\'s port', () => {
  const origin = {
    sap_discharge_ports: 'TSB TRADING PLANT 1',
    discharge_ports_klip: 'TSB TRADING PLANT 1',
    port_of_discharge: 'TSB TRADING PLANT 1',
  }

  it('the child\'s port replaces SAP\'s and KLIP\'s, open or closed', () => {
    for (const closed of [true, false]) {
      expect(
        resolveShipmentListDischargePorts({ ...origin, is_contract_sap_closed: closed, discharge_port_b2b_child: 'PORT BATAM' }),
      ).toBe('PORT BATAM')
    }
  })

  it('an empty child port (none, or a user typed the shipment\'s port) leaves the row as it was', () => {
    expect(resolveShipmentListDischargePorts({ ...origin, is_contract_sap_closed: false, discharge_port_b2b_child: null })).toBe('TSB TRADING PLANT 1')
    expect(resolveShipmentListDischargePorts({ ...origin, is_contract_sap_closed: true, discharge_port_b2b_child: '' })).toBe('TSB TRADING PLANT 1')
    expect(
      resolveShipmentListDischargePorts({ discharge_ports_klip: 'PORT DUMAI', sap_discharge_ports: 'TSB TRADING PLANT 1', is_contract_sap_closed: false, discharge_port_b2b_child: null }),
    ).toBe('PORT DUMAI')
  })

  it('a child port that is a numeric code or a placeholder is no port', () => {
    expect(resolveShipmentListDischargePorts({ ...origin, is_contract_sap_closed: false, discharge_port_b2b_child: '74.66' })).toBe('TSB TRADING PLANT 1')
  })
})
