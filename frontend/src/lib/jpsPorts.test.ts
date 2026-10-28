import { describe, expect, it } from 'vitest'
import { DEFAULT_JPS_PORTS, describePorts, parsePortsValue, portState, portsProblems, serializePorts, type JpsPortOptions } from './jpsPorts'

const options: JpsPortOptions = {
  ports: [
    { port: 'PORT BONTANG', hasDhmCode: true, dhmCode: 'PORT-0048', shipments: 794 },
    { port: 'PORT DUMAI', hasDhmCode: true, dhmCode: 'PORT-0010', shipments: 16 },
    { port: 'PORT PELINTUNG', hasDhmCode: false, dhmCode: null, shipments: 1 },
  ],
}

describe('the Ports value: rows <-> the saved string', () => {
  it('an empty or unreadable value is no port at all: nothing is built into KLIP', () => {
    for (const raw of [null, undefined, '', '   ', 'garbage', '{}', '[]']) {
      expect(parsePortsValue(raw)).toEqual([])
    }
    expect(DEFAULT_JPS_PORTS).toEqual([])
  })

  it('round-trips, and keeps what is typed as typed (so "PORT DUMAI" can be typed with its space)', () => {
    const rows = [
      { port: 'PORT BONTANG', enabled: true },
      { port: 'port ', enabled: false },
    ]
    expect(parsePortsValue(serializePorts(rows))).toEqual(rows)
  })

  it('the read-only view upper-cases and trims, like the backend', () => {
    expect(describePorts(serializePorts([{ port: ' port dumai ', enabled: false }]))).toEqual(['PORT DUMAI · nonaktif'])
  })
})

describe('what the editor says before the server does', () => {
  it('a missing port, ALL, and a duplicate', () => {
    expect(portsProblems([{ port: '', enabled: false }])).toEqual(['Baris 1: Master Port belum dipilih.'])
    expect(portsProblems([{ port: 'all', enabled: true }])).toEqual(['ALL bukan port: sebutkan tiap port yang dikirim.'])
    expect(portsProblems([{ port: 'PORT A', enabled: true }, { port: ' port a ', enabled: false }])).toContain('PORT A terdaftar dua kali.')
    expect(portsProblems([])).toEqual([])
  })

  it('a port is ok only when it is a Master Port with a DHM code', () => {
    expect(portState('port bontang', options)).toBe('ok')
    expect(portState('PORT PELINTUNG', options)).toBe('no_dhm_code')
    expect(portState('PORT NOWHERE', options)).toBe('not_found')
    expect(portState('', options)).toBe('not_found')
    // options not loaded yet: no false warning
    expect(portState('PORT NOWHERE', null)).toBe('ok')
  })
})
