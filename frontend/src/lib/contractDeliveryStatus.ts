export function normalizeContractDeliveryStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toUpperCase()
}

/** UI label: legacy ACTIVE/COMPLETED → Open/Close (aligned with Sea + SAP GR PO/STO). */
export function formatContractDeliveryStatusLabel(status: unknown): string {
  const raw = String(status ?? '').trim()
  if (!raw) return ''
  const u = raw.toUpperCase()
  if (u === 'ACTIVE' || u === 'OPEN') return 'Open'
  if (u === 'CLOSE' || u === 'CLOSED' || u === 'COMPLETED' || u === 'COMPLETE') return 'Close'
  if (u === 'CANCELLED' || u === 'CANCELED' || u === 'CANCEL') return 'Cancelled'
  if (raw === 'Open' || raw === 'Close' || raw === 'Cancelled') return raw
  return raw
}

export function isContractDeliveryClosed(status: string | null | undefined): boolean {
  const normalized = normalizeContractDeliveryStatus(status)
  return (
    normalized === 'CLOSE' ||
    normalized === 'CLOSED' ||
    normalized === 'COMPLETED' ||
    normalized === 'COMPLETE'
  )
}

export function resolveContractDeliveryStatus(
  importStatus?: string | null,
  fallbackStatus?: string | null,
): string {
  return String(importStatus || fallbackStatus || '').trim()
}

export function isContractRecordClosed(
  record:
    | {
        import_status?: string | null
        contract_import_status?: string | null
        contract_status?: string | null
        status?: string | null
      }
    | null
    | undefined,
): boolean {
  if (!record) return false
  const status = resolveContractDeliveryStatus(
    record.import_status ?? record.contract_import_status,
    record.contract_status ?? record.status,
  )
  return isContractDeliveryClosed(status)
}
