'use client'

import { createContext, useContext, type ReactNode } from 'react'

const StitchFieldContext = createContext(false)

/** Turns on Stitch field radius and color for controls rendered under this tree. */
export function StitchFields({ children }: { children: ReactNode }) {
  return <StitchFieldContext.Provider value={true}>{children}</StitchFieldContext.Provider>
}

export function useStitchFields() {
  return useContext(StitchFieldContext)
}

/** Map the existing control classes onto the Stitch field tokens. */
export function stitchControlClass(base: string, stitch: boolean) {
  if (!stitch) return base
  return base
    .replaceAll('rounded-md', 'rounded-lg')
    .replaceAll('border-gray-300', 'border-slate-200')
    .replaceAll('ring-blue-500', 'ring-blue-600')
    .replaceAll('focus:border-slate-500', 'focus:border-blue-600')
    .replaceAll('focus:ring-slate-500', 'focus:ring-blue-600')
}
