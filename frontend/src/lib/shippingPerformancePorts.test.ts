import { describe, expect, it } from 'vitest'
import {
  isGenericKlipPortPlaceholder,
  resolveShippingPerfDischargePort,
} from './shippingPerformancePorts'

describe('isGenericKlipPortPlaceholder', () => {
  it('detects legacy generic labels', () => {
    expect(isGenericKlipPortPlaceholder('Loading Port 1')).toBe(true)
    expect(isGenericKlipPortPlaceholder('Discharge Port')).toBe(true)
  })
})

describe('resolveShippingPerfDischargePort and the B2B ending child', () => {
  it('a B2B origin is at its ending child\'s port, not the company in the middle', () => {
    expect(
      resolveShippingPerfDischargePort({
        discharge_port_b2b_child: 'PORT BATAM',
        sap_vessel_discharge_port: 'TSB TRADING PLANT 1',
        port_of_discharge: 'TSB TRADING PLANT 1',
      }),
    ).toBe('PORT BATAM')
  })

  it('without a child port the row shows what it did before (SAP first, then KLIP)', () => {
    expect(resolveShippingPerfDischargePort({ sap_vessel_discharge_port: 'PORT BONTANG', port_of_discharge: 'PORT DUMAI' })).toBe('PORT BONTANG')
    expect(resolveShippingPerfDischargePort({ discharge_port_b2b_child: null, port_of_discharge: 'PORT DUMAI' })).toBe('PORT DUMAI')
  })

  it('a child port that is blank, a numeric SAP code or a placeholder is no port: the row keeps its own', () => {
    for (const child of ['', '  ', '0.00', '74.66', 'Discharge Port', 'Blank']) {
      expect(
        resolveShippingPerfDischargePort({ discharge_port_b2b_child: child, sap_vessel_discharge_port: 'PORT BONTANG' }),
      ).toBe('PORT BONTANG')
    }
  })
})

describe('resolveShippingPerfDischargePort', () => {
  it('skips generic vlp name and uses port_of_discharge', () => {
    expect(
      resolveShippingPerfDischargePort({
        vlp_discharge_port_name: 'Discharge Port',
        port_of_discharge: 'PORT TANJUNG PRIOK',
      }),
    ).toBe('PORT TANJUNG PRIOK')
  })
})
