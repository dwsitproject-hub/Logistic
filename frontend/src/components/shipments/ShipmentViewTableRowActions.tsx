'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileText, Pencil, Ship, Ban } from 'lucide-react'
import {
  canCancelKlipShipment,
  cancelKlipShipmentDisabledReason,
  resolveShipmentTablePrimaryAction,
} from '@/lib/shipmentViewTableActions'

export interface ShipmentViewTableRowActionsShipment {
  id: string
  status?: string | null
  row_kind?: string | null
  sto_number?: string | null
  sto_key?: string | null
  operation_id?: string | null
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
  const primary = resolveShipmentTablePrimaryAction(shipment.status)
  const canCancel = canCancelKlipShipment(shipment)
  const cancelDisabledReason = cancelKlipShipmentDisabledReason(shipment)
  const showCancel = typeof onCancelShipment === 'function'
  const cancelDisabled = !canCancel || cancelShipmentLoading

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
              className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
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
              className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
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
            className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
            aria-label="Edit shipment"
          >
            {primaryActionLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
            ) : (
              <span className="relative inline-flex h-4 w-4 items-center justify-center">
                <Ship className="h-4 w-4" />
                <Pencil className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 rounded-[1px] bg-white" />
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Edit shipment</TooltipContent>
      </Tooltip>
    )
  })()

  return (
    <div className="flex items-center justify-end gap-2 min-h-[40px]">
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
                    ? 'border-gray-200 bg-gray-50 text-gray-400'
                    : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                }
                aria-label="Cancel shipment"
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
            {canCancel
              ? 'Cancel shipment (KLIP only)'
              : cancelDisabledReason || 'Cancel not available'}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={onViewDocs}
            title="Docs"
            className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
            aria-label="View documents"
          >
            <FileText className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">View documents</TooltipContent>
      </Tooltip>
    </div>
  )
}
