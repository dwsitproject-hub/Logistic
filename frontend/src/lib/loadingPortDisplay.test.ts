import {
  isValidHumanPortName,
  resolveKlipPortInputValue,
  resolveLoadingPortDisplayFromRow,
  resolveLoadingPortDisplayLabel,
} from './loadingPortDisplay'

describe('loadingPortDisplay', () => {
  it('prefers SAP over KLIP and shows dash when both invalid', () => {
    expect(
      resolveLoadingPortDisplayLabel({
        sapPortName: 'Ketapang',
        klipPortName: '67.30',
      }),
    ).toBe('Ketapang')

    expect(
      resolveLoadingPortDisplayLabel({
        sapPortName: '67.30',
        klipPortName: 'Sadai',
      }),
    ).toBe('Sadai')

    expect(
      resolveLoadingPortDisplayLabel({
        sapPortName: '67.30',
        klipPortName: '0.00',
      }),
    ).toBe('—')
  })

  it('resolves from port row with sap_port_name and shipment info fallback', () => {
    expect(
      resolveLoadingPortDisplayFromRow(
        { port_name: '67.30', sap_port_name: null },
        { sap_vessel_loading_port_2: 'Sadai' },
        2,
      ),
    ).toBe('Sadai')

    expect(
      resolveLoadingPortDisplayFromRow(
        { port_name: '67.30', sap_port_name: null },
        {},
        2,
      ),
    ).toBe('—')
  })

  it('extracts KLIP input only when human-readable', () => {
    expect(isValidHumanPortName('67.30')).toBe(false)
    expect(resolveKlipPortInputValue('67.30')).toBe('')
    expect(resolveKlipPortInputValue('Ketapang')).toBe('Ketapang')
  })
})
