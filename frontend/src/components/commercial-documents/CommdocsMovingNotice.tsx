'use client'

import { ExternalLink, Info } from 'lucide-react'
import { commercialDocumentsAppUrl } from '@/lib/commdocsApp'

/**
 * Commercial Documents is moving to its own app (COD). This page stays in KLIP for now; the notice says it is going away and where to go.
 * The button shows only when the app's address is configured (NEXT_PUBLIC_COMMDOCS_URL); without it the text still tells people.
 */
export function CommdocsMovingNotice() {
  const appUrl = commercialDocumentsAppUrl()
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <p>
          <span className="font-semibold">This page will be removed from KLIP.</span> Commercial Documents now has its own app (COD).
          Please use COD from now on: it shows the same documents.
        </p>
      </div>
      {appUrl ? (
        <a
          href={appUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Open Commercial Documents (COD)
        </a>
      ) : null}
    </div>
  )
}
