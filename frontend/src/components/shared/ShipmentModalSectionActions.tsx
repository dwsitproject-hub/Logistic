'use client'

import { Button } from '@/components/ui/button'
import { Edit2, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const SECTION_BTN_CLASS = 'h-7 text-xs'

type SectionActionButtonProps = {
  onClick: () => void
  disabled?: boolean
  className?: string
}

export function SectionEditButton({
  label = 'Edit',
  lockLabel = 'Cancel',
  isEditing = false,
  onClick,
  disabled,
  className,
}: SectionActionButtonProps & {
  label?: string
  lockLabel?: string
  isEditing?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(SECTION_BTN_CLASS, className)}
      onClick={onClick}
      disabled={disabled}
    >
      <Edit2 className="mr-1 h-3.5 w-3.5" />
      {isEditing ? lockLabel : label}
    </Button>
  )
}

export function SectionAddButton({
  label = 'Add',
  onClick,
  disabled,
  className,
}: SectionActionButtonProps & { label?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(SECTION_BTN_CLASS, className)}
      onClick={onClick}
      disabled={disabled}
    >
      <Plus className="mr-1 h-3.5 w-3.5" />
      {label}
    </Button>
  )
}

export function SectionCancelButton({
  label = 'Cancel',
  onClick,
  disabled,
  className,
}: SectionActionButtonProps & { label?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(SECTION_BTN_CLASS, 'text-red-600 hover:text-red-700', className)}
      onClick={onClick}
      disabled={disabled}
    >
      <X className="mr-1 h-3.5 w-3.5" />
      {label}
    </Button>
  )
}

export function SectionActionGroup({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('flex gap-2', className)}>{children}</div>
}
