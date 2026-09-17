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
