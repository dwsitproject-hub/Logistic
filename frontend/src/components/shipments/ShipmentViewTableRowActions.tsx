'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileText, Ship, Ban } from 'lucide-react'
import { normalizeShipmentStatusKey } from '@/lib/shipmentStatusDisplay'
import { useDocumentPresence } from '@/lib/documentPresence'
import {
  cancelKlipShipmentDisabledReason,
  cancelPrePlannedGroupDisabledReason,
  resolveShipmentTablePrimaryAction,
  resolveShipmentViewTableCancelKind,
} from '@/lib/shipmentViewTableActions'

export interface ShipmentViewTableRowActionsShipment {
  id: string
  status?: string | null
  row_kind?: string | null
  sto_number?: string | null
  sto_key?: string | null
  operation_id?: string | null
  pre_planned_group_id?: string | null
}

export interface ShipmentViewTableRowActionsProps {
  shipment: ShipmentViewTableRowActionsShipment
  onAddShipment: () => void
  onEditShipment: () => void
  onViewShipment: () => void
  onCancelShipment?: () => void
  cancelShipmentLoading?: boolean
  primaryActionLoading?: boolean
  onViewDocs: () => void
}

/**
 * Unified Actions column for the Shipments page main view table only.
 * Primary (ship) · Cancel · View Docs (file).
 */
export function ShipmentViewTableRowActions({
  shipment,
  onAddShipment,
  onEditShipment,
  onViewShipment,
  onCancelShipment,
  cancelShipmentLoading = false,
  primaryActionLoading = false,
  onViewDocs,
}: ShipmentViewTableRowActionsProps) {
  // A backlog row's documents hang on its contract; every other row's on its shipment. Unknown (not answered yet) keeps the button on.
  const hasDocs = useDocumentPresence(String(shipment.row_kind ?? '').trim() === 'contract_backlog' ? 'contract' : 'shipment', shipment.id)
  const docsDisabled = hasDocs === false
  const primary = resolveShipmentTablePrimaryAction(shipment.status)
  const cancelKind = resolveShipmentViewTableCancelKind(shipment)
  const canCancel = cancelKind != null
  const cancelDisabledReason = canCancel
    ? null
    : normalizeShipmentStatusKey(shipment.status) === 'PREPLANNED'
      ? cancelPrePlannedGroupDisabledReason(shipment)
      : cancelKlipShipmentDisabledReason(shipment)
  const showCancel = typeof onCancelShipment === 'function'
  const cancelDisabled = !canCancel || cancelShipmentLoading
  const cancelLabel =
    cancelKind === 'preplanned'
      ? 'Return all POs in this group to Unplanned'
      : cancelKind === 'klip_shipment'
        ? 'Cancel shipment (KLIP only)'
        : cancelDisabledReason || 'Cancel not available'
  const cancelAriaLabel =
    cancelKind === 'preplanned' ? 'Cancel preplanned group' : 'Cancel shipment'

  const primaryButton = (() => {
    if (primary === 'add') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onAddShipment}
              disabled={primaryActionLoading}
              className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
              aria-label="Add shipment"
            >
              {primaryActionLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
              ) : (
                <Ship className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Add shipment</TooltipContent>
        </Tooltip>
      )
    }

    if (primary === 'view') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onViewShipment}
              disabled={primaryActionLoading}
              className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
              aria-label="View shipment"
            >
              {primaryActionLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
              ) : (
                <Ship className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">View shipment</TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={onEditShipment}
            disabled={primaryActionLoading}
            className="h-8 w-8 border-transparent bg-transparent text-blue-600 hover:bg-blue-50"
            aria-label="Edit shipment"
          >
            {primaryActionLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
            ) : (
              <Ship className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Edit shipment</TooltipContent>
      </Tooltip>
    )
  })()

  return (
    <div className="flex items-center justify-center gap-1 min-h-[40px]">
      {primaryButton}
      {showCancel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Span keeps tooltip working when the button is disabled */}
            <span className="inline-flex">
              <Button
                variant="outline"
                size="icon"
                onClick={onCancelShipment}
                disabled={cancelDisabled}
                className={
                  cancelDisabled
                    ? 'h-8 w-8 border-transparent bg-transparent text-gray-300'
                    : 'h-8 w-8 border-transparent bg-transparent text-red-600 hover:bg-red-50'
                }
                aria-label={cancelAriaLabel}
              >
                {cancelShipmentLoading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-red-700" />
                ) : (
                  <Ban className="h-4 w-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {cancelLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="outline"
              size="icon"
              onClick={onViewDocs}
              disabled={docsDisabled}
              title={docsDisabled ? undefined : 'Docs'}
              className="h-8 w-8 border-transparent bg-transparent text-violet-600 hover:bg-violet-50 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="View documents"
            >
              <FileText className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{docsDisabled ? 'No documents uploaded yet' : 'View documents'}</TooltipContent>
      </Tooltip>
    </div>
  )
}
