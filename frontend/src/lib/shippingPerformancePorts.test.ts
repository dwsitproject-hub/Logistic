import { describe, expect, it } from 'vitest'
import {
  applySection3PortDisplay,
  isPortCodeLike,
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
} from './shippingPerformancePorts'

describe('shippingPerformancePorts', () => {
  it('detects numeric SAP port codes (Vessel LOA)', () => {
    expect(isPortCodeLike('74.66')).toBe(true)
    expect(isPortCodeLike('PORT TALANG DUKU')).toBe(false)
    expect(isPortCodeLike('Dumai')).toBe(false)
  })

  it('prefers SAP loading port over KLIP shipment input', () => {
    expect(
      resolveShippingPerfLoadingPort({
        vlp_loading_port_name: 'PORT DUMAI',
        port_of_loading: 'PORT DUMAI',
        sap_vessel_loading_port_1: 'PORT TALANG DUKU',
      }),
    ).toBe('PORT TALANG DUKU')
  })

  it('falls back to KLIP port_of_loading when SAP is null', () => {
    expect(
      resolveShippingPerfLoadingPort({
        port_of_loading: 'PORT DUMAI',
        vlp_loading_port_name: 'PORT VLP',
      }),
    ).toBe('PORT DUMAI')
  })

  it('falls back to vessel_loading_ports name when SAP and port_of_loading are empty', () => {
    expect(
      resolveShippingPerfLoadingPort({
        vlp_loading_port_name: 'PORT DUMAI',
      }),
    ).toBe('PORT DUMAI')
  })

  it('skips LOA-like SAP codes and falls back to KLIP port name', () => {
    expect(
      resolveShippingPerfLoadingPort({
        port_of_loading: 'PORT TALANG DUKU',
        sap_vessel_loading_port_1: '74.66',
      }),
    ).toBe('PORT TALANG DUKU')
  })

  it('prefers SAP discharge port over KLIP shipment input', () => {
    expect(
      resolveShippingPerfDischargePort({
        port_of_discharge: 'PORT MARUNDA CENTRAL (MCT)',
        sap_vessel_discharge_port: 'PORT BONTANG',
      }),
    ).toBe('PORT BONTANG')
  })

  it('falls back to KLIP discharge when SAP is null', () => {
    expect(
      resolveShippingPerfDischargePort({
        port_of_discharge: 'PORT MARUNDA CENTRAL (MCT)',
      }),
    ).toBe('PORT MARUNDA CENTRAL (MCT)')
  })

  it('applySection3PortDisplay writes resolved port names onto the row', () => {
    const row = applySection3PortDisplay({
      port_of_loading: 'PORT DUMAI',
      sap_vessel_loading_port_1: 'PORT KUMAI',
      port_of_discharge: 'PORT MARUNDA CENTRAL (MCT)',
      sap_vessel_discharge_port: 'PORT BONTANG',
    })
    expect(row.loading_port).toBe('PORT KUMAI')
    expect(row.discharge_port).toBe('PORT BONTANG')
  })
})
