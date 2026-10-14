'use client'

import { useCallback, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatQtyMtFromKg } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  isCurrentSto,
  outstandingBasis,
  poStoOutstandingHelpText,
  sumStoFulfilment,
  type StoFulfilmentRow,
} from '@/lib/poStoOutstanding'

type Props = {
  /** Distinct SAP STOs on the PO (above 1: the OS Qty is reduced by the others too). */
  stoCount: number
  incoterm?: string | null
  /** Contract row id: with it the helper lists the STOs with their Delivery | Receive. Without it (SAP-only contract) only the explanation is shown. */
  contractRowId?: string | null
  /** STO of the row / modal the figure is on, marked in the list. */
  currentSto?: string | null
  className?: string
}

type StoListRow = StoFulfilmentRow & { sto_number?: string | null; type?: string | null }

/**
 * (i) beside an OS Qty that several STOs of one PO reduced. On hover it says so and lists every STO of the PO with its Delivery and Receive Qty, so the user can
 * see that the OS Qty already has the other STOs' quantities taken off. The list is fetched the first time it is opened (the contract's own STO information, as in
 * Contract Details), not with every row.
 */
export function PoStoOutstandingHelp({ stoCount, incoterm, contractRowId, currentSto, className }: Props) {
  const [stos, setStos] = useState<StoListRow[] | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const requested = useRef(false)

  const load = useCallback(async () => {
    if (requested.current || !contractRowId) return
    requested.current = true
    setState('loading')
    try {
      const res = await api.get(`/contracts/${contractRowId}/sto-information`)
      setStos(((res.data?.data?.stos ?? []) as StoListRow[]).filter((row) => String(row.sto_number ?? '').trim() !== ''))
      setState('done')
    } catch {
      requested.current = false
      setState('error')
    }
  }, [contractRowId])

  const basis = outstandingBasis(incoterm)
  const totals = stos ? sumStoFulfilment(stos) : null
  const countedHead = 'underline decoration-dotted underline-offset-2'

  return (
    <Tooltip
      delayDuration={150}
      onOpenChange={(open) => {
        if (open) void load()
      }}
    >
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label="Why this OS Qty is the PO's, not this STO's"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full text-blue-500 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-primary/30',
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md text-xs leading-relaxed">
        <p className="whitespace-pre-wrap">{poStoOutstandingHelpText(stoCount, incoterm)}</p>
        {contractRowId ? (
          <div className="mt-2">
            {state === 'loading' || state === 'idle' ? <p className="text-gray-500">Loading STOs…</p> : null}
            {state === 'error' ? <p className="text-red-600">STO list could not be loaded.</p> : null}
            {state === 'done' && stos && stos.length > 0 ? (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1 pr-3 text-left font-medium">STO</th>
                    <th className={cn('py-1 pr-3 text-right font-medium', basis === 'delivery' && countedHead)}>Delivery</th>
                    <th className={cn('py-1 text-right font-medium', basis === 'receive' && countedHead)}>Receive</th>
                  </tr>
                </thead>
                <tbody>
                  {stos.map((row, index) => {
                    const current = isCurrentSto(row.sto_number, currentSto)
                    return (
                      <tr key={`${row.sto_number}-${index}`} className={cn('border-b last:border-b-0', current && 'bg-blue-50 font-semibold')}>
                        <td className="py-1 pr-3 text-left tabular-nums">
                          {row.sto_number}
                          {row.type === 'trucking' ? <span className="ml-1 text-amber-700">(trucking)</span> : null}
                          {current ? <span className="ml-1 font-normal text-blue-700">(this STO)</span> : null}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{formatQtyMtFromKg(row.quantity_delivered)}</td>
                        <td className="py-1 text-right tabular-nums">{formatQtyMtFromKg(row.quantity_receive)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {totals ? (
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td className="py-1 pr-3 text-left">Total</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{formatQtyMtFromKg(totals.delivery)}</td>
                      <td className="py-1 text-right tabular-nums">{formatQtyMtFromKg(totals.receive)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            ) : null}
            {state === 'done' && stos && stos.length === 0 ? <p className="text-gray-500">No STO information for this PO.</p> : null}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
