'use client'

import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRowDocumentPresence } from '@/lib/documentPresence'

interface Props {
  /** The trucking operation's id; ignored for a contract backlog row (it has no operation yet). */
  operationId: string
  /** The row's contract, whose own documents the DO dialog also lists. */
  contractId: string
  /** The row's PO key as Commercial Documents knows it (the PO number, else the contract number): the DO uploaded there is listed in the dialog as well. */
  poKey?: string
  backlog: boolean
  onClick: () => void
}

/**
 * The violet View DO button of a Trucking row. It is off while the row has nothing to show: no document on its operation, none on its contract and no DO in Commercial Documents
 * for its PO (the three the dialog merges). While the answer is not known yet the button stays on.
 */
export function TruckingDocumentsButton({ operationId, contractId, poKey = '', backlog, onClick }: Props) {
  const hasDocs = useRowDocumentPresence(
    backlog ? null : { kind: 'trucking', id: operationId },
    contractId ? { kind: 'contract', id: contractId } : null,
    poKey ? { kind: 'cod', id: poKey } : null,
  )
  const disabled = hasDocs === false
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'No DO uploaded yet' : 'View DO'}
      aria-label="View DO"
      className="h-8 w-8 border-transparent bg-transparent text-violet-600 hover:bg-violet-50 disabled:opacity-40"
    >
      <FileText className="h-4 w-4" />
    </Button>
  )
}
