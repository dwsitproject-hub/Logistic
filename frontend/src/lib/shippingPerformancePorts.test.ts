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

  it('prefers shipment operation loading port name over SAP', () => {
    expect(
      resolveShippingPerfLoadingPort({
        vlp_loading_port_name: 'PORT DUMAI',
        sap_vessel_loading_port_1: 'PORT TALANG DUKU',
      }),
    ).toBe('PORT DUMAI')
  })

  it('skips LOA-like codes and falls back to SAP port name', () => {
    expect(
      resolveShippingPerfLoadingPort({
        port_of_loading: '74.66',
        sap_vessel_loading_port_1: 'PORT TALANG DUKU',
      }),
    ).toBe('PORT TALANG DUKU')
  })

  it('prefers shipment discharge port name over SAP', () => {
    expect(
      resolveShippingPerfDischargePort({
        port_of_discharge: 'PORT MARUNDA CENTRAL (MCT)',
        sap_vessel_discharge_port: 'PORT BONTANG',
      }),
    ).toBe('PORT MARUNDA CENTRAL (MCT)')
  })

  it('applySection3PortDisplay writes resolved port names onto the row', () => {
    const row = applySection3PortDisplay({
      port_of_loading: '69.00',
      sap_vessel_loading_port_1: 'PORT KUMAI',
      port_of_discharge: 'PORT MARUNDA CENTRAL (MCT)',
    })
    expect(row.loading_port).toBe('PORT KUMAI')
    expect(row.discharge_port).toBe('PORT MARUNDA CENTRAL (MCT)')
  })
})
