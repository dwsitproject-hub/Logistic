import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignSelectedToRegionSiteOptions } from '@/lib/globalScopeFilters'

const APP = join(process.cwd(), 'src', 'app')

/**
 * A user scoped to Region/Plant Bontang saw "1 selected (OR)" with the box unticked.
 *
 * The two values come from different places and disagree on case: the scope is stored against
 * `master_plants` and reaches the page as `Bontang`, while the dropdown options are DISTINCT SAP
 * Discharge Destination and arrive as `BONTANG`. Both spellings are real - confirmed against the
 * dev database - and the backend was never wrong, matching `UPPER(...) IN (UPPER($n))`, so the
 * rows on screen were correctly scoped the whole time. Only the checkbox was lying.
 */
describe('Region/Plant scope alignment', () => {
  const OPTION = 'BONTANG'
  const STORED = 'Bontang'

  it('reproduces the bug: the stored spelling does not tick the option', () => {
    // SearchableMultiSelect renders `checked={selected.includes(option)}`.
    expect([STORED].includes(OPTION)).toBe(false)
    // ...while the label counts state entries, hence "1 selected (OR)" with nothing ticked.
    expect([STORED].length).toBe(1)
  })

  it('aligning the selection to the options ticks the box', () => {
    const aligned = alignSelectedToRegionSiteOptions([STORED], [OPTION])
    expect(aligned.includes(OPTION)).toBe(true)
  })

  /**
   * Why this is fixed in the state rather than in the comparison: the toggle removes with
   * `selected.filter((s) => s !== value)`. A box ticked by a looser comparison would still be
   * filtered by strict equality, so it could be ticked and never unticked.
   */
  it('the aligned value can also be unticked again', () => {
    const aligned = alignSelectedToRegionSiteOptions([STORED], [OPTION])
    expect(aligned.filter((s) => s !== OPTION)).toEqual([])
    // The unaligned value is what would have survived the filter and stayed stuck.
    expect([STORED].filter((s) => s !== OPTION)).toEqual([STORED])
  })

  it('leaves an already-matching selection untouched and drops Blank', () => {
    expect(alignSelectedToRegionSiteOptions([OPTION], [OPTION])).toEqual([OPTION])
    expect(alignSelectedToRegionSiteOptions(['Blank'], [OPTION])).toEqual([])
  })
})

/**
 * Every page with a Region/Plant filter has to realign, and forgetting one is invisible until a
 * scoped user opens that page - the count still reads right, so nothing looks broken in testing.
 * Source-audited because there is no renderHook here (no @testing-library in this project).
 */
describe('every Region/Plant page realigns its scope', () => {
  // The options state is not named the same everywhere - Commercial Documents calls it
  // `availablePlants` - so each page names the variable its own effect must pass.
  const PAGES: Array<[string, string]> = [
    ['contracts', 'availableGroupPlants'],
    ['shipments', 'availableGroupPlants'],
    ['trucking', 'availableGroupPlants'],
    ['oil-loss', 'availableGroupPlants'],
    ['shipping-performance', 'availableGroupPlants'],
    ['commercial-documents', 'availablePlants'],
  ]

  for (const [page, optionsVar] of PAGES) {
    it(`${page} aligns the scope to its loaded options`, () => {
      const src = readFileSync(join(APP, page, 'page.tsx'), 'utf8')
      expect(src).toContain(`alignGroupPlantsToOptions(${optionsVar})`)
    })
  }

  it('Contract Performance realigns its own scope, not just the Contracts one', () => {
    // contracts/page.tsx drives two independent scopes from one file.
    const src = readFileSync(join(APP, 'contracts', 'page.tsx'), 'utf8')
    expect(src).toContain('alignContractPerfGroupPlantsToOptions(availableGroupPlants)')
  })

  it('the hook exposes the callback the pages call', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'hooks', 'useUserScopeFilterDefaults.ts'),
      'utf8',
    )
    expect(src).toContain('const alignGroupPlantsToOptions = useCallback')
    // Returning the same reference when nothing changes is what keeps the effect from looping.
    expect(src).toContain('return unchanged ? current : aligned')
  })
})
