'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const HeaderFilterSlotContext = createContext<HTMLElement | null>(null)
const HeaderFilterSlotSetterContext = createContext<((el: HTMLElement | null) => void) | null>(null)

export function HeaderFilterSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <HeaderFilterSlotContext.Provider value={slot}>
      <HeaderFilterSlotSetterContext.Provider value={setSlot}>
        {children}
      </HeaderFilterSlotSetterContext.Provider>
    </HeaderFilterSlotContext.Provider>
  )
}

export function HeaderFilterSlotTarget({ className }: { className?: string }) {
  const setSlot = useContext(HeaderFilterSlotSetterContext)
  return <div ref={setSlot ?? undefined} className={className} />
}

export function HeaderFilterSlot({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderFilterSlotContext)
  if (!slot) return null
  return createPortal(children, slot)
}
