'use client'

import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { CloudUpload } from 'lucide-react'

interface Props {
  /** A file was dropped on the zone (the page checks that it is an Excel file). */
  onFile: (file: File) => void
  /** The zone was clicked: open the file picker. */
  onBrowse: () => void
  disabled?: boolean
}

/** Where an SAP export goes: drop it here or click to browse. Only shown to people who may upload. */
export function SapImportDropZone({ onFile, onBrowse, disabled = false }: Props) {
  const [over, setOver] = useState(false)

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    if (disabled) return
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onBrowse()
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Upload an SAP export file"
      onClick={() => {
        if (!disabled) onBrowse()
      }}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={[
        'flex items-center gap-4 rounded-xl border-2 border-dashed px-5 py-5 outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        disabled
          ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
          : over
            ? 'cursor-copy border-blue-500 bg-blue-50'
            : 'cursor-pointer border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/40',
      ].join(' ')}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        <CloudUpload className="h-6 w-6" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {over ? 'Release to upload' : 'Drop an SAP export here, or browse'}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">.xlsx, .xlsm, .xlsb or .xls. Large files can take several minutes.</p>
      </div>
    </div>
  )
}
