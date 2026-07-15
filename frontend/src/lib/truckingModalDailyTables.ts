/** Helpers for Truck Planning / Truck Actual read-only tables in the trucking modal. */

export interface TruckingModalPlanningRow {
  date: string
  quantity_delivery_kg: number
}

export interface TruckingModalActualRow {
  date: string
  quantity_delivery_kg: number
  quantity_receive_kg: number | null
}

export function parseDailyDeliverablesRaw(
  raw: unknown,
): Array<{ date?: string; quantity_delivered?: number }> {
  if (Array.isArray(raw)) return raw as Array<{ date?: string; quantity_delivered?: number }>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** Normalize planning upload rows (daily_deliverables) → Date | Qty Delivery. */
export function normalizePlanningDeliverableRows(raw: unknown): TruckingModalPlanningRow[] {
  return parseDailyDeliverablesRaw(raw)
    .map((r) => {
      const date = String(r.date ?? '').slice(0, 10)
      const qty = Number(r.quantity_delivered)
      return {
        date,
        quantity_delivery_kg: Number.isFinite(qty) ? qty : 0,
      }
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Normalize WB daily actuals.
 * Prefer quantity_delivery_kg / quantity_receive_kg; legacy quantity_kg → delivery only.
 */
export function normalizeDailyActualRows(raw: unknown): TruckingModalActualRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r: Record<string, unknown>) => {
      const date = String(r.date ?? r.progress_date ?? '').slice(0, 10)
      const deliveryRaw = r.quantity_delivery_kg ?? r.quantity_delivered ?? r.quantity_kg
      const receiveRaw = r.quantity_receive_kg
      const delivery = Number(deliveryRaw)
      const receive =
        receiveRaw == null || receiveRaw === ''
          ? null
          : Number(receiveRaw)
      return {
        date,
        quantity_delivery_kg: Number.isFinite(delivery) ? delivery : 0,
        quantity_receive_kg: receive != null && Number.isFinite(receive) ? receive : null,
      }
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function sumPlanningDeliveryKg(rows: TruckingModalPlanningRow[]): number {
  return rows.reduce((s, r) => s + (Number(r.quantity_delivery_kg) || 0), 0)
}

export function sumActualDeliveryKg(rows: TruckingModalActualRow[]): number {
  return rows.reduce((s, r) => s + (Number(r.quantity_delivery_kg) || 0), 0)
}

export function sumActualReceiveKg(rows: TruckingModalActualRow[]): number {
  return rows.reduce((s, r) => {
    const n = r.quantity_receive_kg
    return s + (n != null && Number.isFinite(n) ? n : 0)
  }, 0)
}

/** Format kg as MT with 2 decimals; null/undefined/NaN → "-". */
export function formatSapQtyMtOrDash(valueKg: unknown): string {
  if (valueKg == null || valueKg === '') return '-'
  const n = typeof valueKg === 'number' ? valueKg : parseFloat(String(valueKg).replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return '-'
  const mt = n / 1000
  return mt.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
}

export function formatQtyKgAsMt(valueKg: number): string {
  const mt = valueKg / 1000
  return mt.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
}

export function formatIsoDateDisplay(iso: string): string {
  const d = (iso || '').slice(0, 10)
  if (d.length < 10) return iso || '-'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}
