import React, { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KlipSapCompareField } from '@/components/shared/KlipSapCompareField'
import { createDischargePortResolver, drawnPortLabel } from '@/lib/dischargePortFilter'

// the component source relies on the automatic JSX runtime (no React import); vitest transpiles with the classic one, so give it React
;(globalThis as { React?: unknown }).React = React

const resolver = createDischargePortResolver([
  { identity: 'BONTANG', canonical: 'PORT BONTANG' },
  { identity: 'EUP EDIBLE OIL BONTANG', canonical: 'PORT BONTANG' },
])
const draw = (text: string) => drawnPortLabel(text, resolver)

type Props = Parameters<typeof KlipSapCompareField>[0]
const render = (props: Props) => renderToStaticMarkup(createElement(KlipSapCompareField, props))

describe('KlipSapCompareField draws a port as its Master Port without changing what it compares', () => {
  it('the shown KLIP value and the SAP reference are the Master Port, the raw SAP text is the tooltip of the reference', () => {
    const html = render({ label: 'Discharge Port', klipValue: 'PORT DUMAI', sapValue: 'EUP EDIBLE OIL BONTANG', format: 'text', textDisplay: draw })
    expect(html).toContain('PORT BONTANG')
    expect(html).toContain('title="SAP: EUP EDIBLE OIL BONTANG"')
    // an unmapped KLIP text stays as it is
    expect(html).toContain('PORT DUMAI')
    expect(html).not.toContain('>EUP EDIBLE OIL BONTANG<')
  })

  it('without textDisplay nothing changes: the SAP wording is shown', () => {
    const html = render({ label: 'Discharge Port', klipValue: 'PORT DUMAI', sapValue: 'EUP EDIBLE OIL BONTANG', format: 'text' })
    expect(html).toContain('EUP EDIBLE OIL BONTANG')
    expect(html).not.toContain('PORT BONTANG')
  })

  it('a text SAP and KLIP agree on has no mismatch marker (provenance compares the raw texts, not the drawn ones)', () => {
    const html = render({ label: 'Discharge Port', klipValue: 'EUP EDIBLE OIL BONTANG', sapValue: 'EUP EDIBLE OIL BONTANG', format: 'text', textDisplay: draw })
    expect(html).not.toContain('border-amber-400')
  })

  it('two different raw texts that are the same Master Port are still flagged as different (the raw values are compared)', () => {
    const html = render({ label: 'Discharge Port', klipValue: 'BONTANG', sapValue: 'EUP EDIBLE OIL BONTANG', format: 'text', textDisplay: draw })
    expect(html).toContain('border-amber-400')
  })

  it('a field that is not a port is unaffected when no draw function is given', () => {
    const html = render({ label: 'Voyage', klipValue: 'V-12', sapValue: 'V-13', format: 'text' })
    expect(html).toContain('V-12')
    expect(html).toContain('V-13')
  })
})
