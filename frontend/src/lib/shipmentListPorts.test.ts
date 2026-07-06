import { describe, expect, it } from 'vitest'
import {
  resolveShipmentListDischargePorts,
  resolveShipmentListLoadingPorts,
} from './shipmentListPorts'

describe('shipmentListPorts', () => {
  it('uses SAP Vessel Loading Port only when present (not KLIP)', () => {
    expect(
      resolveShipmentListLoadingPorts({
        sap_loading_ports: 'Port A, Port B',
        port_of_loading: 'Port C',
        loading_ports_klip: 'Port D',
      }),
    ).toBe('Port A, Port B')
  })

  it('falls back to KLIP shipment operation ports when SAP is empty', () => {
    expect(
      resolveShipmentListLoadingPorts({
        loading_ports_klip: 'Belawan, Dumai',
      }),
    ).toBe('Belawan, Dumai')
  })

  it('falls back to port_of_loading when SAP and vlp agg are empty', () => {
    expect(
      resolveShipmentListLoadingPorts({
        port_of_loading: 'Jakarta',
      }),
    ).toBe('Jakarta')
  })

  it('uses SAP Vessel Discharge Port before KLIP discharge', () => {
    expect(
      resolveShipmentListDischargePorts({
        sap_discharge_ports: 'Surabaya',
        port_of_discharge: 'Jakarta',
      }),
    ).toBe('Surabaya')
  })

  it('skips numeric SAP port codes and uses KLIP fallback', () => {
    expect(
      resolveShipmentListDischargePorts({
        sap_discharge_ports: '74.66',
        port_of_discharge: 'Jakarta',
      }),
    ).toBe('Jakarta')
  })
})
