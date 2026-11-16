import { describe, expect, it } from 'vitest'
import { pagerItems } from './ListPager'

describe('pagerItems', () => {
  it('lists every page when there are seven or fewer', () => {
    expect(pagerItems(1, 1)).toEqual([1])
    expect(pagerItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps the first and last page with gaps in between', () => {
    expect(pagerItems(1, 62)).toEqual([1, 2, 3, 4, 5, 'gap', 62])
    expect(pagerItems(3, 62)).toEqual([1, 2, 3, 4, 5, 'gap', 62])
    expect(pagerItems(4, 62)).toEqual([1, 'gap', 3, 4, 5, 'gap', 62])
    expect(pagerItems(30, 62)).toEqual([1, 'gap', 29, 30, 31, 'gap', 62])
    expect(pagerItems(60, 62)).toEqual([1, 'gap', 58, 59, 60, 61, 62])
    expect(pagerItems(62, 62)).toEqual([1, 'gap', 58, 59, 60, 61, 62])
  })

  it('always includes the current page and the last page', () => {
    for (const total of [8, 9, 20, 62]) {
      for (let page = 1; page <= total; page++) {
        const items = pagerItems(page, total)
        expect(items).toContain(page)
        expect(items[items.length - 1]).toBe(total)
        expect(items[0]).toBe(1)
      }
    }
  })
})
