import { describe, expect, it } from 'vitest'
import {
  countUsersByRole,
  filterDirectoryUsers,
  roleToneClass,
  summarizeUsers,
  userInitials,
  userRegionPlants,
  userStatus,
  type DirectoryUser,
} from './userDirectory'

const user = (over: Partial<DirectoryUser>): DirectoryUser => ({
  id: 'u',
  email: 'a@example.com',
  full_name: 'Ana Lee',
  role: 'LOGISTICS',
  is_active: true,
  is_first_login: false,
  ...over,
})

describe('userStatus', () => {
  it('tells active, invited-but-not-started and switched-off apart', () => {
    expect(userStatus({ is_active: true, is_first_login: false })).toBe('active')
    expect(userStatus({ is_active: true, is_first_login: true })).toBe('pending')
    expect(userStatus({ is_active: false, is_first_login: true })).toBe('inactive')
  })

  it('summarises into three groups that add up to the total', () => {
    const s = summarizeUsers([
      user({}),
      user({ is_first_login: true }),
      user({ is_active: false }),
      user({ is_active: false, is_first_login: true }),
    ])
    expect(s).toEqual({ total: 4, active: 1, pending: 1, inactive: 2 })
  })
})

describe('filterDirectoryUsers', () => {
  const list = [
    user({ id: '1', full_name: 'Siti Rahma', email: 'siti@x.com', role: 'LOGISTICS', department: 'Operations' }),
    user({ id: '2', full_name: 'Dedi K', email: 'dedi@x.com', role: 'TRADING', is_first_login: true }),
    user({ id: '3', full_name: 'Maya', email: 'maya@x.com', role: 'TRADING', is_active: false }),
  ]
  const f = (over: Partial<{ search: string; role: string; status: 'all' | 'active' | 'pending' | 'inactive' }>) =>
    filterDirectoryUsers(list, { search: '', role: '', status: 'all', ...over }).map((u) => u.id)

  it('keeps everyone with no filter', () => expect(f({})).toEqual(['1', '2', '3']))
  it('filters by role', () => expect(f({ role: 'TRADING' })).toEqual(['2', '3']))
  it('filters by status', () => expect(f({ status: 'pending' })).toEqual(['2']))
  it('combines role and status', () => expect(f({ role: 'TRADING', status: 'inactive' })).toEqual(['3']))
  it('searches name, e-mail and department without caring about case', () => {
    expect(f({ search: 'SITI' })).toEqual(['1'])
    expect(f({ search: 'dedi@' })).toEqual(['2'])
    expect(f({ search: 'operations' })).toEqual(['1'])
    expect(f({ search: 'nobody' })).toEqual([])
  })
  it('counts users per role', () => {
    expect(countUsersByRole(list)).toEqual({ LOGISTICS: 1, TRADING: 2 })
  })
})

describe('row facts', () => {
  it('makes initials from two words, one word or the e-mail', () => {
    expect(userInitials('siti rahma putri')).toBe('SR')
    expect(userInitials('Maya')).toBe('MA')
    expect(userInitials('', 'zed@x.com')).toBe('Z')
  })

  it('reads the plants from whichever field is filled, group plants first', () => {
    expect(userRegionPlants({ group_plants: ['BONTANG'], plants: ['X'], plant: 'Y' })).toEqual(['BONTANG'])
    expect(userRegionPlants({ plants: ['X'], plant: 'Y' })).toEqual(['X'])
    expect(userRegionPlants({ plant: 'A, B' })).toEqual(['A', 'B'])
    expect(userRegionPlants({})).toEqual([])
  })

  it('gives a role created later the same colour every time', () => {
    expect(roleToneClass('AR UPSTREAM')).toBe(roleToneClass('AR UPSTREAM'))
    expect(roleToneClass('ADMIN')).toContain('violet')
  })
})
