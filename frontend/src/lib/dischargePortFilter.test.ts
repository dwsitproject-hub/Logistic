import { describe, expect, it } from 'vitest'
import {
  dischargePortIdentity,
  dischargePortLabel,
  dischargePortOptionsFrom,
  matchesDischargePortSelection,
} from '@/lib/dischargePortFilter'
import { rowDischargePort, rowMatchesToolbarMultiFilters } from '@/lib/globalScopeFilters'

describe('dischargePortFilter', () => {
  it('a label is trimmed, single-spaced, upper-cased; no port is Blank', () => {
    expect(dischargePortLabel('  Port   Bontang ')).toBe('PORT BONTANG')
    expect(dischargePortLabel('')).toBe('Blank')
    expect(dischargePortLabel(null)).toBe('Blank')
    expect(dischargePortLabel(undefined)).toBe('Blank')
  })

  it('spelling variants of one port share an identity; different ports do not', () => {
    const same = ['BONTANG', 'Port Bontang', 'PORT OF BONTANG', 'port  of  bontang', 'Pelabuhan Bontang']
    expect(new Set(same.map(dischargePortIdentity)).size).toBe(1)
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
  })

  it('options: one entry per port, picks first-listed even without rows, Blank last', () => {
    expect(dischargePortOptionsFrom(['dumai', 'DUMAI', 'Port Bontang', 'BONTANG', '', null], [])).toEqual(['DUMAI', 'PORT BONTANG', 'Blank'])
    expect(dischargePortOptionsFrom(['DUMAI'], ['kijing'])).toEqual(['DUMAI', 'KIJING'])
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
})
