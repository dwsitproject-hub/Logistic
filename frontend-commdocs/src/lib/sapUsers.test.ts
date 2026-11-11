import { describe, expect, it } from 'vitest'
import { readSapUsers } from './sapUsers'

// SAP pads the headers and the values with spaces
const HEAD = ['Client', 'User        ', 'First Name                              ', 'Last Name                               ']

describe('readSapUsers', () => {
  it('reads the users and trims the padding', () => {
    const r = readSapUsers([HEAD, [300, '04124040143 ', 'Vicky     ', '          '], [300, 'TH0001      ', 'Ana       ', 'Budi      ']])
    expect(r?.rows).toEqual([
      { user_id: '04124040143', client: '300', first_name: 'Vicky', last_name: '' },
      { user_id: 'TH0001', client: '300', first_name: 'Ana', last_name: 'Budi' },
    ])
    expect(r).toMatchObject({ duplicates: 0, skipped: 0 })
  })
  it('keeps the first row of a user listed twice, and skips rows without a user', () => {
    const r = readSapUsers([HEAD, [300, 'U1', 'A', 'B'], [300, 'U1', 'X', 'Y'], [300, '', 'No', 'User'], ['', '', '', '']])
    expect(r?.rows).toEqual([{ user_id: 'U1', client: '300', first_name: 'A', last_name: 'B' }])
    expect(r).toMatchObject({ duplicates: 1, skipped: 1 })
  })
  it('finds the header by name and is null for another report', () => {
    expect(readSapUsers([['title'], ['Last Name', 'User', 'First Name'], ['L', 'U9', 'F']])?.rows).toEqual([{ user_id: 'U9', client: '', first_name: 'F', last_name: 'L' }])
    expect(readSapUsers([['Purchasing Document', 'Created by'], ['1001', 'U1']])).toBeNull()
  })
})
