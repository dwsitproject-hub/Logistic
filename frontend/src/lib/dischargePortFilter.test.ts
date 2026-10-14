import { describe, expect, it } from 'vitest'
import {
  createDischargePortResolver,
  dischargePortIdentity,
  dischargePortLabel,
  dischargePortOptionsFrom,
  matchesDischargePortSelection,
} from '@/lib/dischargePortFilter'
import { rowDischargePort, rowMatchesToolbarMultiFilters } from '@/lib/globalScopeFilters'

/** What GET /contracts/filter-options/discharge-port-map returns for a slice of the real Master Port and alias data. */
const resolver = createDischargePortResolver([
  { identity: 'BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'TSB TRADING PLANT 1', canonical: 'PORT BONTANG' },
  { identity: 'DUMAI', canonical: 'PORT DUMAI' },
])

describe('dischargePortFilter: spelling only (no map)', () => {
  it('a label is trimmed, single-spaced, upper-cased; no port is Blank', () => {
    expect(dischargePortLabel('  Port   Bontang ')).toBe('PORT BONTANG')
    expect(dischargePortLabel('')).toBe('Blank')
    expect(dischargePortLabel(null)).toBe('Blank')
    expect(dischargePortLabel(undefined)).toBe('Blank')
  })

  it('spelling variants of one port share an identity; different ports do not', () => {
    const same = ['BONTANG', 'Port Bontang', 'PORT OF BONTANG', 'port  of  bontang', 'Pelabuhan Bontang']
    expect(new Set(same.map((v) => dischargePortIdentity(v))).size).toBe(1)
    expect(dischargePortIdentity('DUMAI')).not.toBe(dischargePortIdentity('BONTANG'))
    // Blank is its own identity, and never collides with a port
    expect(dischargePortIdentity('')).toBe(dischargePortIdentity(null))
    expect(dischargePortIdentity('')).not.toBe(dischargePortIdentity('BONTANG'))
  })

  it('an empty selection matches everything; Blank matches only rows without a port', () => {
    expect(matchesDischargePortSelection('DUMAI', [])).toBe(true)
    expect(matchesDischargePortSelection('DUMAI', undefined)).toBe(true)
    expect(matchesDischargePortSelection('DUMAI', ['Blank'])).toBe(false)
    expect(matchesDischargePortSelection('', ['Blank'])).toBe(true)
    expect(matchesDischargePortSelection('port of bontang', ['BONTANG', 'DUMAI'])).toBe(true)
    // without the map a plant name is not folded onto its port
    expect(matchesDischargePortSelection('EUP EDIBLE OIL BONTANG', ['PORT BONTANG'])).toBe(false)
  })

  it('options: one entry per port, picks first-listed even without rows, Blank last', () => {
    expect(dischargePortOptionsFrom(['dumai', 'DUMAI', 'Port Bontang', 'BONTANG', '', null], [])).toEqual(['DUMAI', 'PORT BONTANG', 'Blank'])
    expect(dischargePortOptionsFrom(['DUMAI'], ['kijing'])).toEqual(['DUMAI', 'KIJING'])
  })
})

describe('dischargePortFilter: through the Master Port mapping', () => {
  it('an empty or missing map is no map', () => {
    expect(createDischargePortResolver([])).toBeNull()
    expect(createDischargePortResolver(null)).toBeNull()
  })

  it('a plant name that is an alias is listed and matched as the Master Port it maps to', () => {
    expect(dischargePortLabel('EUP EDIBLE OIL BONTANG', resolver)).toBe('PORT BONTANG')
    expect(dischargePortLabel('Bontang', resolver)).toBe('PORT BONTANG')
    expect(dischargePortLabel('tsb trading plant 1', resolver)).toBe('PORT BONTANG')
    expect(matchesDischargePortSelection('EUP EDIBLE OIL BONTANG', ['PORT BONTANG'], resolver)).toBe(true)
    expect(matchesDischargePortSelection('BONTANG', ['EUP EDIBLE OIL BONTANG'], resolver)).toBe(true)
    expect(matchesDischargePortSelection('PORT DUMAI', ['PORT BONTANG'], resolver)).toBe(false)
  })

  it('a text nobody mapped stays itself, and is still found by its own name', () => {
    expect(dischargePortLabel('EUP TRADING PLANT', resolver)).toBe('EUP TRADING PLANT')
    expect(matchesDischargePortSelection('EUP TRADING PLANT', ['EUP TRADING PLANT'], resolver)).toBe(true)
    expect(matchesDischargePortSelection('EUP TRADING PLANT', ['PORT BONTANG'], resolver)).toBe(false)
  })

  it('options list the Master Port once, however many texts the rows use for it; Blank stays last', () => {
    const rows = ['EUP EDIBLE OIL BONTANG', 'BONTANG', 'PORT BONTANG', 'TSB TRADING PLANT 1', 'DUMAI', 'EUP TRADING PLANT', '']
    expect(dischargePortOptionsFrom(rows, [], resolver)).toEqual(['EUP TRADING PLANT', 'PORT BONTANG', 'PORT DUMAI', 'Blank'])
    // an old pick written as the plant name is listed as the port, once
    expect(dischargePortOptionsFrom(rows, ['EUP EDIBLE OIL BONTANG'], resolver)).toEqual(['EUP TRADING PLANT', 'PORT BONTANG', 'PORT DUMAI', 'Blank'])
  })

  it('Blank is unaffected by the map', () => {
    expect(dischargePortLabel('', resolver)).toBe('Blank')
    expect(matchesDischargePortSelection(null, ['Blank'], resolver)).toBe(true)
  })
})

describe('Shipping Performance row discharge port', () => {
  it('is the port the table shows: SAP Vessel Discharge Port first, then the KLIP shipment, never a code or placeholder', () => {
    expect(rowDischargePort({ sap_vessel_discharge_port: 'BONTANG', port_of_discharge: 'DUMAI' })).toBe('BONTANG')
    expect(rowDischargePort({ port_of_discharge: 'DUMAI' })).toBe('DUMAI')
    expect(rowDischargePort({ port_of_discharge: 'Blank', discharge_port: 'Discharge Port' })).toBe('')
    expect(rowDischargePort({ sap_vessel_discharge_port: '74.66', port_of_discharge: 'KIJING' })).toBe('KIJING')
  })

  it('rowMatchesToolbarMultiFilters applies it together with the other toolbar filters', () => {
    const row = { incoterm: 'FOB', plant_site: 'BONTANG', port_of_discharge: 'PORT BONTANG' }
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['BONTANG'] })).toBe(true)
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['DUMAI'] })).toBe(false)
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['BONTANG'], selectedIncoterms: ['CIF'] })).toBe(false)
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['BONTANG'], selectedGroupPlants: ['BONTANG'] })).toBe(true)
    // no selection: unchanged behaviour for every page that does not use the filter
    expect(rowMatchesToolbarMultiFilters(row, {})).toBe(true)
    expect(rowMatchesToolbarMultiFilters({ incoterm: 'FOB' }, { selectedDischargePorts: [] })).toBe(true)
  })

  it('with the map, a row whose SAP port is a plant name is found by its Master Port', () => {
    const row = { incoterm: 'FOB', sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG' }
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['PORT BONTANG'], dischargePortResolver: resolver })).toBe(true)
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['PORT BONTANG'] })).toBe(false)
  })
})
