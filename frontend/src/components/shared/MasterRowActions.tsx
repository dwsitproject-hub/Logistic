'use client'

import { Edit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface MasterRowActionsProps {
  editLabel: string
  onEdit: () => void
}

/**
 * Icon edit action for the master data tables. There is deliberately no delete button: a master
 * row is referenced by contracts, shipments and DHM, so rows are edited, not removed from the page.
 */
export function MasterRowActions({ editLabel, onEdit }: MasterRowActionsProps) {
  return (
    <div className="inline-flex items-center justify-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={onEdit}
            className="h-8 w-8 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
            aria-label={editLabel}
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{editLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}
