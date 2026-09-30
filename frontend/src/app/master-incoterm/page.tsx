'use client'

import { ReferenceMasterPage, type ReferenceField } from '@/components/shared/ReferenceMasterPage'

const FIELDS: ReferenceField[] = [{ key: 'value_1', label: 'Incoterms', required: true }]

export default function MasterIncotermPage() {
  return (
    <ReferenceMasterPage
      kind="incoterm"
      title="All Incoterms"
      description="Maintain incoterms and reconcile them with DHM."
      newLabel="New Incoterm"
      fields={FIELDS}
      storageKey="master-incoterm.visibleColumns.v2"
      codeNoun="Incoterm"
      syncDhm
      dhmNoun="incoterm"
    />
  )
}
