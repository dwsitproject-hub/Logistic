'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  categoryTitle,
  enabledPermissionCount,
  filterPermissionRows,
  groupPermissionsByCategory,
  isAllChecked,
  orderedCategories,
  sortPermissionRows,
  type PermissionField,
  type PermissionRow,
} from '@/lib/rolePermissionsView'

interface Props {
  permissions: PermissionRow[]
  loading: boolean
  roleLabel: string
  onChange: (permissionId: string, field: PermissionField, value: boolean) => void
  onSetAll: (permissionId: string, value: boolean) => void
}

const COLUMNS: ReadonlyArray<{ field: PermissionField; label: string }> = [
  { field: 'can_view', label: 'View' },
  { field: 'can_create', label: 'Create' },
  { field: 'can_edit', label: 'Edit' },
  { field: 'can_delete', label: 'Delete' },
]

const GRID = 'grid grid-cols-[minmax(0,1fr)_repeat(4,3.25rem)_3.5rem] items-center gap-2'

function CategoryNote({ category }: { category: string }) {
  if (category === 'page') {
    return (
      <p className="px-5 py-2 text-xs text-gray-500">
        Includes <strong>Commercial Documents</strong> (<code>page.commercial_documents</code>) for contract payment document access.
      </p>
    )
  }
  if (category === 'data') {
    return (
      <p className="px-5 py-2 text-xs text-gray-500">
        <strong>Commercial Documents Data</strong> (<code>data.commercial_documents</code>) controls file management on that page (Delete).{' '}
        <strong>Commercial Documents Upload: ...</strong> (<code>data.commercial_documents.upload.*</code>) decides, per document type, which role may upload it: tick Create
        (or Edit) for the role, level and transport that may.
      </p>
    )
  }
  return null
}

/** The permissions of one role scope: a tab per category, a search box, and one row per permission with View, Create, Edit and Delete in aligned columns. */
export function PermissionMatrix({ permissions, loading, roleLabel, onChange, onSetAll }: Props) {
  const grouped = useMemo(() => groupPermissionsByCategory(permissions), [permissions])
  const categories = useMemo(() => orderedCategories(grouped), [grouped])
  const [active, setActive] = useState('')
  const [query, setQuery] = useState('')

  // Keep a valid tab: the first one when the role (or its scope) changes the categories under it.
  useEffect(() => {
    if (!categories.includes(active)) setActive(categories[0] ?? '')
  }, [categories, active])

  const rows = useMemo(
    () => sortPermissionRows(filterPermissionRows(grouped[active] ?? [], query)),
    [grouped, active, query],
  )

  if (!loading && permissions.length === 0) {
    return <div className="px-5 py-12 text-center text-sm text-gray-500">No permissions to show for this scope.</div>
  }

  return (
    <div className={loading ? 'opacity-60' : undefined} aria-busy={loading}>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gray-200 px-3 pt-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Permission categories">
          {categories.map((category) => {
            const list = grouped[category]
            const selected = category === active
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(category)}
                className={
                  selected
                    ? 'border-b-2 border-blue-600 px-3 py-2 text-sm font-medium text-blue-700'
                    : 'border-b-2 border-transparent px-3 py-2 text-sm text-gray-600 hover:text-gray-900'
                }
              >
                {categoryTitle(category)}
                <span className="ml-1.5 text-xs tabular-nums text-gray-400">
                  {enabledPermissionCount(list)}/{list.length}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative mb-1.5 w-52">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search permissions"
            className="h-8 pl-8 text-xs"
            aria-label="Search permissions"
          />
        </div>
      </div>

      <CategoryNote category={active} />

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className={`${GRID} border-b border-gray-200 bg-gray-50 px-5 py-2 text-xs font-medium text-gray-500`}>
            <div>Permission for {roleLabel}</div>
            {COLUMNS.map((column) => (
              <div key={column.field} className="text-center">
                {column.label}
              </div>
            ))}
            <div className="text-center">Row</div>
          </div>
          {rows.map((permission) => (
            <div key={permission.id} className={`${GRID} border-b border-gray-100 px-5 py-2.5 last:border-b-0 hover:bg-gray-50`}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900">{permission.permission_name}</div>
                {permission.description ? <div className="truncate text-xs text-gray-500">{permission.description}</div> : null}
                <div className="truncate font-mono text-[0.6875rem] text-gray-400">{permission.permission_key}</div>
              </div>
              {COLUMNS.map((column) => (
                <div key={column.field} className="flex justify-center">
                  <Checkbox
                    checked={Boolean(permission[column.field])}
                    disabled={loading}
                    aria-label={`${column.label} ${permission.permission_name}`}
                    onCheckedChange={(checked) => onChange(permission.id, column.field, checked === true)}
                  />
                </div>
              ))}
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-blue-700 hover:bg-blue-50"
                  disabled={loading}
                  onClick={() => onSetAll(permission.id, !isAllChecked(permission))}
                >
                  {isAllChecked(permission) ? 'None' : 'All'}
                </Button>
              </div>
            </div>
          ))}
          {rows.length === 0 ? <div className="px-5 py-10 text-center text-sm text-gray-500">No permission matches this search.</div> : null}
        </div>
      </div>
    </div>
  )
}
