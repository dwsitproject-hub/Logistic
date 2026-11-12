import { describe, expect, it } from 'vitest'
import { pagerWindow } from './ListPager'

describe('pagerWindow', () => {
  it('shows every page when there are five or fewer', () => {
    expect(pagerWindow(1, 1)).toEqual([1])
    expect(pagerWindow(2, 4)).toEqual([1, 2, 3, 4])
    expect(pagerWindow(5, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('stays at the start, follows the middle and stays at the end', () => {
    expect(pagerWindow(1, 53)).toEqual([1, 2, 3, 4, 5])
    expect(pagerWindow(3, 53)).toEqual([1, 2, 3, 4, 5])
    expect(pagerWindow(10, 53)).toEqual([8, 9, 10, 11, 12])
    expect(pagerWindow(51, 53)).toEqual([49, 50, 51, 52, 53])
    expect(pagerWindow(53, 53)).toEqual([49, 50, 51, 52, 53])
  })
})
