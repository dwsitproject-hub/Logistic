'use client'

import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRowDocumentPresence } from '@/lib/documentPresence'

interface Props {
  /** The trucking operation's id; ignored for a contract backlog row (it has no operation yet). */
  operationId: string
  /** The row's contract, whose own documents the Documents dialog also lists. */
  contractId: string
  backlog: boolean
  onClick: () => void
}

/**
 * The violet Documents button of a Trucking row. It is off while the row has nothing to show: no document on its operation and none on its contract (the two the
 * Documents dialog merges). While the answer is not known yet the button stays on.
 */
export function TruckingDocumentsButton({ operationId, contractId, backlog, onClick }: Props) {
  const hasDocs = useRowDocumentPresence(
    backlog ? null : { kind: 'trucking', id: operationId },
    contractId ? { kind: 'contract', id: contractId } : null,
  )
  const disabled = hasDocs === false
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'No documents uploaded yet' : backlog ? 'Contract documents' : 'Documents'}
      aria-label={backlog ? 'View contract documents' : 'View documents'}
      className="h-8 w-8 border-transparent bg-transparent text-violet-600 hover:bg-violet-50 disabled:opacity-40"
    >
      <FileText className="h-4 w-4" />
    </Button>
  )
}
