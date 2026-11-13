'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Layers, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { filterMultiValues, multiValuePillLabel } from '@/lib/multiValueCell'

interface Props {
  /** Already sorted A-Z (see multiValuesOf). */
  values: readonly string[]
  /** What the row is, for the dialog title: the site name, the company name, the port. */
  rowTitle: string
  /** The column the list belongs to ("Company Name"). */
  columnLabel: string
  /** Plural noun for the pill: "companies", "sites". */
  plural: string
}

/**
 * A master table cell with several values: nothing for none, the value itself for one, and for two or more ONE pill with the count ("20 companies").
 * The pill opens a dialog with every value, one per row, A-Z, with a search and a copy button, so the table keeps one line per row.
 *
 * The cell sits in a clickable row (it opens the row's edit dialog), so clicks and keys in the pill AND in the dialog (a portal, which still bubbles through
 * React to the row) stop here.
 */
export function MultiValueCell({ values, rowTitle, columnLabel, plural }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const shown = useMemo(() => filterMultiValues(values, query), [values, query])

  if (values.length === 0) return <span className="text-sm">-</span>
  if (values.length === 1) return <span className="block max-w-[28rem] whitespace-normal text-sm leading-snug">{values[0]}</span>

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(values.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* the clipboard can be blocked (an insecure page); the list is still on screen */
    }
  }

  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          setQuery('')
          setOpen(true)
        }}
        title={`Show the ${values.length} ${plural}`}
        aria-label={`${rowTitle}: show the ${values.length} ${plural}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium normal-case text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <Layers className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        {multiValuePillLabel(values.length, plural)}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {rowTitle} <span className="font-normal text-slate-500">· {columnLabel}</span>
            </DialogTitle>
            <DialogDescription>
              {values.length} {plural}, A-Z.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${plural}`} className="pl-9" aria-label={`Search ${plural}`} />
          </div>
          <ol className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
            {shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">Nothing matches &quot;{query.trim()}&quot;.</li>
            ) : (
              shown.map((value) => (
                <li key={value} className="flex gap-3 border-b border-slate-100 px-3 py-2 text-sm text-slate-800 last:border-b-0">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-slate-400">{values.indexOf(value) + 1}</span>
                  <span className="min-w-0 break-words">{value}</span>
                </li>
              ))
            )}
          </ol>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{query.trim() ? `${shown.length} of ${values.length}` : `${values.length} in total`}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyAll()}>
              {copied ? <Check className="mr-2 h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="mr-2 h-4 w-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy all'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  )
}
