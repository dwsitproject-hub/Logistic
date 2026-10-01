'use client'

import { ReferenceMasterPage, type ReferenceField } from '@/components/shared/ReferenceMasterPage'

const LOCKED_FIELDS = [{ id: 'type', label: 'Type', value: 'Vendor' }]

const FIELDS: ReferenceField[] = [
  { key: 'value_1', label: 'Source' },
  { key: 'value_2', label: 'Group' },
  { key: 'value_3', label: 'Company Name', required: true },
]

export default function MasterCompanyExtPage() {
  return (
    <ReferenceMasterPage
      kind="ext_company"
      title="All Company (External)"
      description="Maintain external companies and reconcile them with DHM external parties."
      newLabel="New Company"
      fields={FIELDS}
      storageKey="master-company-ext.visibleColumns.v3"
      codeNoun="Company"
      syncDhm
      dhmNoun="external party"
      dhmSyncMaster="ext_company"
      lockedFields={LOCKED_FIELDS}
    />
  )
}
