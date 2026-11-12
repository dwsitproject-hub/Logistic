'use client'

import { AlertCircle, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  changeCount: number
  /** "Logistics, Staff, All Transport". */
  scopeLabel: string
  saving: boolean
  loading: boolean
  onSave: () => void
  onDiscard: () => void
}

/** Always at the foot of the permissions: how many rows differ from what is saved, with Discard and Save. */
export function RoleSaveBar({ changeCount, scopeLabel, saving, loading, onSave, onDiscard }: Props) {
  const dirty = changeCount > 0
  return (
    <div
      className={
        dirty
          ? 'flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3'
          : 'flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3'
      }
      role="status"
      aria-live="polite"
    >
      <p className={dirty ? 'flex items-center gap-1.5 text-xs text-amber-800' : 'text-xs text-gray-500'}>
        {dirty ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> : null}
        {dirty
          ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'} for ${scopeLabel}`
          : `No unsaved changes. Saving only updates ${scopeLabel}.`}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={!dirty || saving}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          Discard
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving || loading}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
