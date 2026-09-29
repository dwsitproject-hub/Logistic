'use client'

import { ReferenceMasterPage, type ReferenceField } from '@/components/shared/ReferenceMasterPage'

const FIELDS: ReferenceField[] = [{ key: 'value_1', label: 'Truck Transporter', required: true }]

export default function MasterTruckTransporterPage() {
  return (
    <ReferenceMasterPage
      kind="truck_transporter"
      title="All Truck Transporters"
      description="Maintain truck transporters and reconcile them with DHM."
      newLabel="New Transporter"
      fields={FIELDS}
      storageKey="master-truck-transporter.visibleColumns.v2"
      codeNoun="Truck Transporter"
    />
  )
}
