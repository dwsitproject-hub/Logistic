'use client'

import { ReferenceMasterPage, type ReferenceField } from '@/components/shared/ReferenceMasterPage'

const FIELDS: ReferenceField[] = [
  { key: 'value_1', label: 'Source' },
  { key: 'value_2', label: 'Group' },
  { key: 'value_3', label: 'Ext Company Name', required: true },
]

export default function MasterCompanyExtPage() {
  return (
    <ReferenceMasterPage
      kind="ext_company"
      title="All Company (Ext)"
      description="Maintain external companies and reconcile them with DHM."
      newLabel="New Company"
      fields={FIELDS}
      storageKey="master-company-ext.visibleColumns.v1"
      syncDhm
      dhmNoun="external company"
    />
  )
}
