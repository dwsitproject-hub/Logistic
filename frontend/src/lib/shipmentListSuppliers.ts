/** Resolved supplier label for Shipments list rows (all STO-linked suppliers). */
export function resolveShipmentListSuppliers(row: {
  suppliers?: string | null
  supplier?: string | null
}): string {
  const aggregated = String(row.suppliers ?? '').trim()
  if (aggregated) return aggregated
  return String(row.supplier ?? '').trim()
}
