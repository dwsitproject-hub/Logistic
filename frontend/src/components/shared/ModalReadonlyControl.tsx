'use client'

import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Trucking-style readonly control: input chrome, black text (not faded disabled gray). */
export const MODAL_READONLY_CONTROL_CLASS =
  'bg-gray-50 cursor-not-allowed text-gray-900 disabled:opacity-100 disabled:text-gray-900'

export function modalReadonlyControlClass(compact?: boolean): string {
  return cn(compact ? 'h-8 text-xs' : 'h-9 text-sm', MODAL_READONLY_CONTROL_CLASS)
}

export function ModalReadonlyDateInput({
  valueIso,
  compact = false,
  className,
}: {
  valueIso: string | null | undefined
  compact?: boolean
  className?: string
}) {
  return (
    <DateInputDdMmYyyy
      valueIso={valueIso ?? ''}
      onChangeIso={() => {}}
      disabled
      className={cn(modalReadonlyControlClass(compact), className)}
    />
  )
}

export function ModalReadonlyTextInput({
  value,
  compact = false,
  className,
}: {
  value: string
  compact?: boolean
  className?: string
}) {
  return (
    <Input
      value={value}
      readOnly
      disabled
      className={cn(modalReadonlyControlClass(compact), className)}
    />
  )
}
