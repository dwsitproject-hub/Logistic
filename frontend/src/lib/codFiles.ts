'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { formatDateTimeDMY } from '@/lib/dateFormat'

/**
 * Files uploaded in Commercial Documents (COD), shown read only inside KLIP (Edit Shipment, the Trucking DO dialog). The server groups them per PO and type, every version,
 * newest first (backend utils/codFiles.ts); a file is opened through COD's own route, so COD's permission decides.
 */

export type CodFileType = 'contract' | 'addendum_contract' | 'delivery_order'

export interface CodFileVersion {
  id: string
  /** 1 = the oldest version still in COD. */
  version: number
  fileName: string
  sizeBytes: number | null
  mimeType: string | null
  uploadedAt: string | null
  uploadedBy: string | null
  isLatest: boolean
}

export interface CodFileGroup {
  poNumber: string
  type: CodFileType
  /** Newest first: versions[0] is the latest. */
  versions: CodFileVersion[]
}

/** "Version 3 · 20/11/2026 14:02 · Sari W. (latest)" - one line of the version dropdown. */
export function codVersionLabel(v: CodFileVersion): string {
  const parts = [`Version ${v.version}`]
  if (v.uploadedAt) parts.push(formatDateTimeDMY(v.uploadedAt))
  if (v.uploadedBy) parts.push(v.uploadedBy)
  return `${parts.join(' · ')}${v.isLatest ? ' (latest)' : ''}`
}

/** The version a block shows: the one picked if it still exists, else the latest (what a block opens on, and what it falls back to after a reload). */
export function pickCodVersion(group: CodFileGroup, pickedId: string | null): CodFileVersion | null {
  return group.versions.find((v) => v.id === pickedId) ?? group.versions[0] ?? null
}

/** The groups of one type, in the order of `poKeys` (so the POs of a shipment keep the order the page shows them in). */
export function codGroupsOfType(groups: CodFileGroup[], type: CodFileType, poKeys: string[]): CodFileGroup[] {
  const out: CodFileGroup[] = []
  for (const po of poKeys) {
    const g = groups.find((x) => x.poNumber === po && x.type === type)
    if (g && g.versions.length > 0) out.push(g)
  }
  return out
}

/**
 * Loads the COD files of these POs. A user who may not open COD gets a 403 and sees no COD section at all, like any other failure: the files are an addition to the page, never
 * a reason for it to break. `groups` is [] until the answer is in.
 */
export function useCodFiles(poKeys: string[], types: CodFileType[], enabled = true) {
  const [groups, setGroups] = useState<CodFileGroup[]>([])
  const [loading, setLoading] = useState(false)
  const poKey = useMemo(() => Array.from(new Set(poKeys.map((p) => p.trim()).filter(Boolean))).join(','), [poKeys])
  const typeKey = types.join(',')

  useEffect(() => {
    if (!enabled || !poKey) {
      setGroups([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .get('/documents/cod-files', { params: { po: poKey, types: typeKey } })
      .then((res) => {
        if (!cancelled) setGroups((res.data?.data?.groups as CodFileGroup[] | undefined) ?? [])
      })
      .catch(() => {
        if (!cancelled) setGroups([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [poKey, typeKey, enabled])

  return { groups, loading }
}

/** Saves one COD file (the download button of a block). Throws on failure; the caller says so. */
export async function downloadCodFile(id: string, fileName: string): Promise<void> {
  const response = await api.get(`/commercial-documents/file/${encodeURIComponent(id)}/download`, { responseType: 'blob' })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
