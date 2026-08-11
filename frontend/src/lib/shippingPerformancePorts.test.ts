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
