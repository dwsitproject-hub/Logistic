import api from '@/lib/api'

export interface EntityRemarkRow {
  id: string
  text: string
  category?: string | null
  created_at?: string | null
  updated_at?: string | null
  username?: string
  full_name?: string
}

export type EntityRemarkType = 'contract' | 'shipment'

export function formatRemarkAuthor(row: EntityRemarkRow): string {
  return row.full_name?.trim() || row.username?.trim() || '—'
}

export function formatRemarkCategoryLabel(category?: string | null): string | null {
  const key = String(category ?? '').trim().toUpperCase()
  if (!key) return null
  if (key === 'CANCEL_SHIPMENT') return 'Shipment cancellation'
  if (key === 'EDIT_SHIPMENT') return 'Edit shipment'
  if (key === 'CARGO_READINESS') return 'Cargo readiness'
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function fetchEntityRemarks(
  entityType: EntityRemarkType,
  entityId: string,
): Promise<EntityRemarkRow[]> {
  const path =
    entityType === 'contract'
      ? `/contracts/${entityId}/remarks`
      : `/shipments/${entityId}/remarks`
  const res = await api.get(path)
  return Array.isArray(res.data?.data) ? res.data.data : []
}
