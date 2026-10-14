import { describe, expect, it } from 'vitest'
import {
  createDischargePortResolver,
  dischargePortIdentity,
  dischargePortLabel,
  dischargePortOptionsFrom,
  masterPortLabel,
  matchesDischargePortSelection,
} from '@/lib/dischargePortFilter'
import { rowDischargePort, rowDischargePortForFilter, rowMatchesToolbarMultiFilters } from '@/lib/globalScopeFilters'
import { dischargePortCandidates } from '@/lib/shippingPerformancePorts'

/** What GET /contracts/filter-options/discharge-port-map returns for a slice of the real Master Port and VESSEL PORT (SAP) data. */
const resolver = createDischargePortResolver([
  { identity: 'BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'PABRIK AJP', canonical: 'PORT BONTANG' },
  { identity: 'DUMAI', canonical: 'PORT DUMAI' },
])

describe('dischargePortFilter: spelling only (no map)', () => {
  it('a drawn label is trimmed, single-spaced, upper-cased; no port is Blank', () => {
    expect(dischargePortLabel('  Port   Bontang ')).toBe('PORT BONTANG')
    expect(dischargePortLabel('')).toBe('Blank')
    expect(dischargePortLabel(null)).toBe('Blank')
    expect(dischargePortLabel(undefined)).toBe('Blank')
  })

  it('spelling variants of one port share an identity; different ports do not', () => {
    const same = ['BONTANG', 'Port Bontang', 'PORT OF BONTANG', 'port  of  bontang', 'Pelabuhan Bontang']
    expect(new Set(same.map((v) => dischargePortIdentity(v))).size).toBe(1)
    expect(dischargePortIdentity('DUMAI')).not.toBe(dischargePortIdentity('BONTANG'))
    expect(dischargePortIdentity('')).toBe(dischargePortIdentity(null))
    expect(dischargePortIdentity('')).not.toBe(dischargePortIdentity('BONTANG'))
  })

  it('an empty selection matches everything; a remembered Blank pick means nothing and is dropped', () => {
    expect(matchesDischargePortSelection('DUMAI', [])).toBe(true)
    expect(matchesDischargePortSelection('DUMAI', undefined)).toBe(true)
    expect(matchesDischargePortSelection('DUMAI', ['Blank'])).toBe(true)
    expect(matchesDischargePortSelection('', ['Blank'])).toBe(true)
    expect(matchesDischargePortSelection('port of bontang', ['BONTANG', 'DUMAI'])).toBe(true)
    // a row with no port is never one of the picked ports
    expect(matchesDischargePortSelection('', ['DUMAI'])).toBe(false)
    // without the map a plant name is not folded onto its port
    expect(matchesDischargePortSelection('EUP EDIBLE OIL BONTANG', ['PORT BONTANG'])).toBe(false)
  })

  it('options: one entry per port as the rows spell it, picks listed even without rows, no Blank', () => {
    expect(dischargePortOptionsFrom(['dumai', 'DUMAI', 'Port Bontang', 'BONTANG', '', null], [])).toEqual(['DUMAI', 'PORT BONTANG'])
    expect(dischargePortOptionsFrom(['DUMAI'], ['kijing'])).toEqual(['DUMAI', 'KIJING'])
    expect(dischargePortOptionsFrom(['DUMAI'], ['Blank'])).toEqual(['DUMAI'])
  })
})

describe('dischargePortFilter: through the Master Port', () => {
  it('an empty or missing map is no map', () => {
    expect(createDischargePortResolver([])).toBeNull()
    expect(createDischargePortResolver(null)).toBeNull()
  })

  it('masterPortLabel: the Master Port a text stands for, or null', () => {
    expect(masterPortLabel('EUP EDIBLE OIL BONTANG', resolver)).toBe('PORT BONTANG')
    expect(masterPortLabel('Bontang', resolver)).toBe('PORT BONTANG')
    expect(masterPortLabel('pabrik ajp', resolver)).toBe('PORT BONTANG')
    expect(masterPortLabel('EUP TRADING PLANT', resolver)).toBeNull()
    expect(masterPortLabel('', resolver)).toBeNull()
    // no map yet: nothing is a Master Port yet
    expect(masterPortLabel('BONTANG', null)).toBeNull()
  })

  it('a plant name that is a VESSEL PORT (SAP) name is matched as the Master Port it belongs to', () => {
    expect(matchesDischargePortSelection('EUP EDIBLE OIL BONTANG', ['PORT BONTANG'], resolver)).toBe(true)
    expect(matchesDischargePortSelection('BONTANG', ['EUP EDIBLE OIL BONTANG'], resolver)).toBe(true)
    expect(matchesDischargePortSelection('PORT DUMAI', ['PORT BONTANG'], resolver)).toBe(false)
  })

  it('a text with no Master Port is NOT found by any pick, not even its own name (it is found by PO and the other searches)', () => {
    expect(matchesDischargePortSelection('EUP TRADING PLANT', ['EUP TRADING PLANT'], resolver)).toBe(false)
    expect(matchesDischargePortSelection('EUP TRADING PLANT', ['PORT BONTANG'], resolver)).toBe(false)
    expect(matchesDischargePortSelection('', ['PORT BONTANG'], resolver)).toBe(false)
    // and it is drawn as it is
    expect(dischargePortLabel('EUP TRADING PLANT', resolver)).toBe('EUP TRADING PLANT')
  })

  it('options list only Master Ports, each once however many texts the rows use for it; no Blank, no plant names', () => {
    const rows = ['EUP EDIBLE OIL BONTANG', 'BONTANG', 'PORT BONTANG', 'PABRIK AJP', 'DUMAI', 'EUP TRADING PLANT', '']
    expect(dischargePortOptionsFrom(rows, [], resolver)).toEqual(['PORT BONTANG', 'PORT DUMAI'])
    // an old pick written as the plant name is listed as the port, once
    expect(dischargePortOptionsFrom(rows, ['EUP EDIBLE OIL BONTANG'], resolver)).toEqual(['PORT BONTANG', 'PORT DUMAI'])
  })
})

describe('Shipping Performance row discharge port', () => {
  it('is the port the table shows: the ending child, SAP Vessel Discharge Port, then the KLIP shipment, never a code or placeholder', () => {
    expect(rowDischargePort({ sap_vessel_discharge_port: 'BONTANG', port_of_discharge: 'DUMAI' })).toBe('BONTANG')
    expect(rowDischargePort({ port_of_discharge: 'DUMAI' })).toBe('DUMAI')
    expect(rowDischargePort({ port_of_discharge: 'Blank', discharge_port: 'Discharge Port' })).toBe('')
    expect(rowDischargePort({ sap_vessel_discharge_port: '74.66', port_of_discharge: 'KIJING' })).toBe('KIJING')
    expect(dischargePortCandidates({ discharge_port_b2b_child: 'KIJING', sap_vessel_discharge_port: 'X', port_of_discharge: 'X' })).toEqual(['KIJING', 'X', 'X'])
  })

  it('the filter reads the first text that HAS a Master Port: a plant name that maps to nothing does not hide the shipment port that does', () => {
    const row = { sap_vessel_discharge_port: 'EUP TRADING PLANT', port_of_discharge: 'PORT DUMAI' }
    expect(rowDischargePortForFilter(row, resolver)).toBe('PORT DUMAI')
    expect(rowDischargePortForFilter(row)).toBe('EUP TRADING PLANT')
    expect(rowDischargePortForFilter({ sap_vessel_discharge_port: 'EUP TRADING PLANT' }, resolver)).toBe('EUP TRADING PLANT')
    expect(rowDischargePortForFilter({}, resolver)).toBe('')
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

  it('with the map, a row whose SAP port is a plant name is found by its Master Port; a row whose texts map to nothing is not found', () => {
    const row = { incoterm: 'FOB', sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG' }
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['PORT BONTANG'], dischargePortResolver: resolver })).toBe(true)
    expect(rowMatchesToolbarMultiFilters(row, { selectedDischargePorts: ['PORT BONTANG'] })).toBe(false)
    const trading = { incoterm: 'FOB', sap_vessel_discharge_port: 'EUP TRADING PLANT' }
    expect(rowMatchesToolbarMultiFilters(trading, { selectedDischargePorts: ['PORT BONTANG'], dischargePortResolver: resolver })).toBe(false)
  })
})

describe('dischargePortFilter: answers are remembered per resolver, never across resolvers', () => {
  const other = createDischargePortResolver([{ identity: 'BONTANG', canonical: 'PORT LOKTUAN' }])

  it('the same text gives the same label again, and a different map gives its own label', () => {
    expect(masterPortLabel('Port Bontang', resolver)).toBe('PORT BONTANG')
    expect(masterPortLabel('Port Bontang', resolver)).toBe('PORT BONTANG')
    expect(masterPortLabel('Port Bontang', other)).toBe('PORT LOKTUAN')
    expect(masterPortLabel('Port Bontang', null)).toBeNull()
  })

  it('a row read with one map and then another follows the second map', () => {
    const row = { sap_vessel_discharge_port: 'EUP EDIBLE OIL BONTANG', port_of_discharge: 'BONTANG' }
    expect(rowDischargePortForFilter(row, resolver)).toBe('EUP EDIBLE OIL BONTANG')
    expect(rowDischargePortForFilter(row, other)).toBe('BONTANG')
    expect(rowDischargePortForFilter(row, null)).toBe('EUP EDIBLE OIL BONTANG')
  })

  it('one selection array matched with two maps uses each map for the picks', () => {
    const picks = ['PORT LOKTUAN']
    expect(matchesDischargePortSelection('BONTANG', picks, resolver)).toBe(false)
    expect(matchesDischargePortSelection('BONTANG', picks, other)).toBe(true)
    // spelling only, before the map loads
    expect(matchesDischargePortSelection('Port Loktuan', picks, null)).toBe(true)
    expect(matchesDischargePortSelection('BONTANG', picks, null)).toBe(false)
  })
})
