'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { createDischargePortResolver, type DischargePortMapEntry, type DischargePortResolver } from '@/lib/dischargePortFilter'

let pending: Promise<DischargePortResolver | null> | null = null

/** One request per page load, shared by every page that filters by Discharge Port. A failure is not kept, so the next page visit tries again. */
function loadDischargePortResolver(): Promise<DischargePortResolver | null> {
  if (!pending) {
    pending = api
      .get('/contracts/filter-options/discharge-port-map')
      .then((res) => createDischargePortResolver((res.data?.data?.entries ?? []) as DischargePortMapEntry[]))
      .catch((error) => {
        console.error('Failed to fetch the discharge port map:', error)
        pending = null
        return null
      })
  }
  return pending
}

/**
 * The Master Port mapping for pages that filter in the browser. Null until it has loaded (or if it cannot): the filter then works on the spelling alone and
 * switches to Master Ports when the map arrives.
 */
export function useDischargePortResolver(): DischargePortResolver | null {
  const [resolver, setResolver] = useState<DischargePortResolver | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadDischargePortResolver().then((value) => {
      if (!cancelled) setResolver(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return resolver
}
