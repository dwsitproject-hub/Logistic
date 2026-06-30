'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileText, Pencil, Ship } from 'lucide-react'
import { resolveShipmentTablePrimaryAction } from '@/lib/shipmentViewTableActions'

export interface ShipmentViewTableRowActionsShipment {
  id: string
  status?: string | null
}

export interface ShipmentViewTableRowActionsProps {
  shipment: ShipmentViewTableRowActionsShipment
  onAddShipment: () => void
  onEditShipment: () => void
  onViewShipment: () => void
  onViewDocs: () => void
}

/**
 * Unified Actions column for the Shipments page main view table only.
 * Primary (ship) · View Docs (file).
 */
export function ShipmentViewTableRowActions({
  shipment,
  onAddShipment,
  onEditShipment,
  onViewShipment,
  onViewDocs,
}: ShipmentViewTableRowActionsProps) {
  const primary = resolveShipmentTablePrimaryAction(shipment.status)

  const primaryButton = (() => {
    if (primary === 'add') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onAddShipment}
              className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
              aria-label="Add shipment"
            >
              <Ship className="h-4 w-4" />
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
              className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
              aria-label="View shipment"
            >
              <Ship className="h-4 w-4" />
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
            className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
            aria-label="Edit shipment"
          >
            <span className="relative inline-flex h-4 w-4 items-center justify-center">
              <Ship className="h-4 w-4" />
              <Pencil className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 rounded-[1px] bg-white" />
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Edit shipment</TooltipContent>
      </Tooltip>
    )
  })()

  return (
    <div className="flex items-center justify-end gap-2 min-h-[40px]">
      {primaryButton}
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
