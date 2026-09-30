'use client'

import { Edit2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface MasterRowActionsProps {
  isAdmin: boolean
  editLabel: string
  deleteLabel: string
  onEdit: () => void
  onDelete: () => void
}

/** Icon edit and delete actions used by Master Vessel. */
export function MasterRowActions({ isAdmin, editLabel, deleteLabel, onEdit, onDelete }: MasterRowActionsProps) {
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
      {isAdmin ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onDelete}
              className="h-8 w-8 bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
              aria-label={deleteLabel}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{deleteLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
