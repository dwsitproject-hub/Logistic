'use client'

import { RouteError } from '@/components/RouteError'
import './globals.css'

/** The root layout itself failed. This file replaces that layout, so it owns <html> and <body>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <RouteError error={error} reset={reset} />
      </body>
    </html>
  )
}
