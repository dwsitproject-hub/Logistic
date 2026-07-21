/** Helpers for Truck Planning / Truck Actual read-only tables in the trucking modal. */

export interface TruckingModalPlanningRow {
  date: string
  quantity_delivery_kg: number
}

export interface TruckingModalActualRow {
  date: string
  quantity_delivery_kg: number
  quantity_receive_kg: number | null
  /** Empty = legacy PO-level WB row (pre multi-STO split). */
  sto_number: string
}

export interface TruckingModalStoActual {
  sto_number: string
  start_receive_date: string
  last_receive_date: string
  qty_delivery: number | null
  qty_receive: number | null
}

/** How Section 4 renders WB daily actuals when multiple STOs exist on one PO. */
export type WbActualsDisplayMode = 'singleSto' | 'perSto' | 'poLevelMultiSto'

/**
 * Resolve WB table layout for Truck Actual (Section 4).
 * - singleSto: one or zero STO rows → PO-level SAP + WB block
 * - perSto: multi-STO with sto-tagged WB rows → split per STO
 * - poLevelMultiSto: multi-STO but WB rows have no sto_number (legacy PO upload)
 */
export function resolveWbActualsDisplayMode(
  actualRows: TruckingModalActualRow[],
  stoActuals: TruckingModalStoActual[],
): WbActualsDisplayMode {
  if (stoActuals.length <= 1) return 'singleSto'
  const stoSet = new Set(stoActuals.map((s) => s.sto_number))
  const hasTagged = actualRows.some((r) => {
    const sto = String(r.sto_number ?? '').trim()
    return sto !== '' && stoSet.has(sto)
  })
  return hasTagged ? 'perSto' : 'poLevelMultiSto'
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
        sto_number: String(r.sto_number ?? '').trim(),
      }
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => {
      const stoCmp = a.sto_number.localeCompare(b.sto_number)
      if (stoCmp !== 0) return stoCmp
      return a.date.localeCompare(b.date)
    })
}

/** Normalize getById / validate `sto_actuals` for Section 4. */
export function normalizeStoActuals(raw: unknown): TruckingModalStoActual[] {
  if (!Array.isArray(raw)) return []
  const toNullableNumber = (v: unknown): number | null => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return raw
    .map((r: Record<string, unknown>) => {
      const sto = String(r.sto_number ?? '').trim()
      const start = String(r.sap_trucking_start_receive_date ?? r.start_receive_date ?? '').slice(0, 10)
      const last = String(r.sap_trucking_last_receive_date ?? r.last_receive_date ?? '').slice(0, 10)
      return {
        sto_number: sto,
        start_receive_date: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : '',
        last_receive_date: /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : '',
        qty_delivery: toNullableNumber(r.sap_qty_delivery ?? r.qty_delivery),
        qty_receive: toNullableNumber(r.sap_qty_receive ?? r.qty_receive),
      }
    })
    .filter((r) => r.sto_number)
    .sort((a, b) => a.sto_number.localeCompare(b.sto_number))
}

/**
 * Filter WB rows for one STO. Also includes legacy empty-STO rows when
 * `includeLegacyEmpty` is true (single-STO or PO-level fallback).
 */
export function filterActualRowsForSto(
  rows: TruckingModalActualRow[],
  stoNumber: string,
  options?: { includeLegacyEmpty?: boolean },
): TruckingModalActualRow[] {
  const sto = String(stoNumber ?? '').trim()
  const includeLegacy = options?.includeLegacyEmpty === true
  return rows.filter((r) => {
    const rowSto = String(r.sto_number ?? '').trim()
    if (rowSto === sto) return true
    if (includeLegacy && !rowSto) return true
    return false
  })
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
