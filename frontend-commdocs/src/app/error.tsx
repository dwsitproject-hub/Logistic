'use client'

import { RouteError } from '@/components/RouteError'

/** Catches a render error in any route, including /login when its chunk fails while the root layout is still up. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />
}
