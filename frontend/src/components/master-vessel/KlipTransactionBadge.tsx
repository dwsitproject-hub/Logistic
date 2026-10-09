'use client'

/** Yes (green) when the vessel has at least one shipment in KLIP, from a SAP import or Add New Shipment; No (red) when it has none. */
export function KlipTransactionBadge({ value }: { value: boolean | null | undefined }) {
  const used = value === true
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        used ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
      title={used ? 'This vessel is on at least one shipment in KLIP' : 'No shipment in KLIP uses this vessel yet'}
    >
      {used ? 'Yes' : 'No'}
    </span>
  )
}
